"""同步通道抽象 + GitHub 实现（Git Data API，无需本地 git 二进制）。

快照在仓库中的布局：
    manifest.json
    data/{table}.json          {"rows":[...]}
    data/tombstones.json       {"table|key": deleted_at}
"""

import base64
import json
import socket

import httpx

from .snapshot import Tombstones, Upsert as Data

SCHEMA_VERSION = 1
API = "https://api.github.com"
TIMEOUT = httpx.Timeout(20, connect=10)


class ProviderError(Exception):
    pass


def _safe_json(resp: httpx.Response) -> dict:
    try:
        j = resp.json()
        return j if isinstance(j, dict) else {}
    except Exception:
        return {}


class Snapshot:
    def __init__(self, data: Data, tombstones: Tombstones, tree_sha: str):
        self.data = data
        self.tombstones = tombstones
        self.tree_sha = tree_sha


class GitHubProvider:
    def __init__(self, repo: str, token: str, branch: str = "main",
                 transport: httpx.BaseTransport | None = None):
        self.repo = repo.strip().strip("/")
        self.token = token.strip()
        self.branch = branch.strip() or "main"
        self._transport = transport

    def _client(self) -> httpx.Client:
        if not self.token:
            raise ProviderError("未配置 PAT")
        return httpx.Client(
            base_url=API,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            timeout=TIMEOUT,
            transport=self._transport,
        )

    def _req(self, client: httpx.Client, method: str, path: str, **kw) -> httpx.Response:
        """404 原样返回（空仓库判定依赖它）；401/403/429 转成带修复指引的错误。

        403 有两种完全不同的含义，必须区分：
        - "Resource not accessible by personal access token" = fine-grained PAT
          权限级别不足（如 Contents 只读），报权限指引
        - x-ratelimit-remaining: 0 = 真限流
        """
        resp = client.request(method, path, **kw)
        if resp.status_code == 401:
            raise ProviderError("PAT 无效或过期（401），请重新生成并填入")
        if resp.status_code == 429 or (
            resp.status_code == 403
            and resp.headers.get("x-ratelimit-remaining") == "0"
        ):
            raise ProviderError("触发 GitHub 限流，请稍后重试")
        if resp.status_code == 403:
            body = _safe_json(resp)
            if "not accessible" in str(body.get("message", "")).lower():
                raise ProviderError(
                    "PAT 权限不足（403）：请到 github.com/settings/personal-access-tokens "
                    "编辑该 PAT，把 Permissions → Repository permissions → Contents "
                    "设为 Read and write 后保存（token 不变，应用里无需重填）")
            raise ProviderError(f"GitHub 拒绝访问（403）：{body.get('message', '未知原因')}")
        return resp

    def test(self) -> dict:
        try:
            with self._client() as c:
                resp = self._req(c, "GET", "/user")
                if resp.status_code == 401:
                    return {"ok": False, "detail": "PAT 无效或过期（401），请重新生成并填入"}
                resp = self._req(c, "GET", f"/repos/{self.repo}")
                if resp.status_code == 404:
                    return {"ok": False, "detail": self._repo_404_detail(c)}
                if resp.is_error:
                    return {"ok": False, "detail": f"HTTP {resp.status_code}"}
                info = resp.json()
                vis = info.get("visibility", "?")
                # 写探针：同步推送用的就是 blob 上传；只读 Contents 会「测试通过、
                # 同步失败」，必须提前在这里验掉（孤儿 blob 无引用，GitHub 自行回收）
                self._ok(self._req(c, "POST", f"/repos/{self.repo}/git/blobs",
                                   json={"content": "dGVzdA==", "encoding": "base64"}),
                         "验证写权限")
                return {"ok": True,
                        "detail": f"连通正常（{self.repo}，{vis}，默认分支 "
                                  f"{info.get('default_branch')}，读写权限 ✓）"}
        except ProviderError as e:
            return {"ok": False, "detail": str(e)}
        except (httpx.HTTPError, socket.error) as e:
            return {"ok": False, "detail": f"网络错误：{e}"}

    def _repo_404_detail(self, c: httpx.Client) -> str:
        """fine-grained PAT 对未授权仓库也返回 404（与仓库真不存在无法区分），
        借 /user/repos（token 视角可见仓库列表）辅助定位真因。"""
        resp = self._req(c, "GET", "/user/repos?per_page=100&sort=full_name")
        names = sorted(r["full_name"] for r in resp.json()) if resp.status_code == 200 else []
        hint = ("github.com/settings/personal-access-tokens 编辑此 PAT，"
                "在 Repository access 中勾选该仓库后保存（token 不变，应用里无需重填）")
        if self.repo in names:
            return f"{self.repo} 可见但访问失败（404），请稍后重试"
        if names:
            shown = "、".join(names[:5]) + ("…" if len(names) > 5 else "")
            return f"PAT 访问不到 {self.repo}（该 PAT 只可见：{shown}）。请到 {hint}"
        return f"仓库 {self.repo} 不存在，或 PAT 未授权任何仓库。请到 {hint}"

    def _ok(self, resp: httpx.Response, action: str) -> httpx.Response:
        if resp.is_error:
            try:
                detail = resp.json().get("message", f"HTTP {resp.status_code}")
            except Exception:
                detail = f"HTTP {resp.status_code}"
            raise ProviderError(f"{action}失败：{detail}")
        return resp

    def fetch(self) -> Snapshot | None:
        """拉远端快照；分支无任何提交（空仓库）返回 None（首次初始化）。

        先验证仓库可访问：fine-grained PAT 对未授权仓库也返回 404，与空仓库
        的分支 404 无法区分，必须先过 /repos 这关才能把「无权访问」报成
        清晰错误而不是误判成空仓库。"""
        with self._client() as c:
            resp = self._req(c, "GET", f"/repos/{self.repo}")
            if resp.status_code == 404:
                raise ProviderError(
                    f"PAT 无法访问仓库 {self.repo}（404）。请到 "
                    "github.com/settings/personal-access-tokens 编辑该 PAT，"
                    "在 Repository access 里勾选此仓库后保存（无需重新生成）")
            self._ok(resp, "访问仓库")

            resp = self._req(c, "GET", f"/repos/{self.repo}/git/ref/heads/{self.branch}")
            # 空仓库返回 409 "Git Repository is empty."；分支不存在返回 404。
            # 两者都代表「远端没有同步状态」。
            if resp.status_code in (404, 409):
                return None
            self._ok(resp, "读取分支")
            head = resp.json()["object"]["sha"]

            resp = self._ok(self._req(c, "GET",
                            f"/repos/{self.repo}/git/trees/{head}?recursive=1"), "读取文件树")
            tree = resp.json()
            blobs = {e["path"]: e["sha"]
                     for e in tree.get("tree", []) if e["type"] == "blob"}

            data: Data = {}
            tombstones: Tombstones = {}
            for path, sha in blobs.items():
                content = self._blob(c, sha)
                if path == "manifest.json":
                    continue
                if not path.startswith("data/") or not path.endswith(".json"):
                    continue
                name = path[len("data/"):-len(".json")]
                payload = json.loads(content)
                if name == "tombstones":
                    for combined, dt in payload.items():
                        table, key = combined.split("|", 1)
                        tombstones[(table, key)] = dt
                else:
                    data[name] = payload.get("rows", [])
            return Snapshot(data, tombstones, tree["sha"])

    def _blob(self, c: httpx.Client, sha: str) -> str:
        resp = self._ok(self._req(c, "GET", f"/repos/{self.repo}/git/blobs/{sha}"), "下载文件")
        return base64.b64decode(resp.json()["content"]).decode("utf-8")

    def push(self, files: dict[str, str], message: str) -> str:
        """files: {path: json 文本}。返回新 commit html_url。"""
        if not files:
            raise ProviderError("没有可推送的变更")
        with self._client() as c:
            resp = self._req(c, "GET", f"/repos/{self.repo}/git/ref/heads/{self.branch}")
            if resp.status_code in (404, 409):
                # 空仓库：Git Data API 在没有任何 commit 时连 blob 都无法创建
                # （POST blobs 也返回 409），必须先用 Contents API 制造第一个 commit
                self._bootstrap_empty_repo(c)
                resp = self._req(c, "GET", f"/repos/{self.repo}/git/ref/heads/{self.branch}")
            self._ok(resp, "读取分支")
            parent_sha = resp.json()["object"]["sha"]

            resp = self._ok(self._req(c, "GET",
                            f"/repos/{self.repo}/git/commits/{parent_sha}"), "读取父提交")
            base_tree = resp.json()["tree"]["sha"]

            tree_entries = []
            for path, text in files.items():
                b64 = base64.b64encode(text.encode("utf-8")).decode("ascii")
                resp = self._ok(self._req(c, "POST", f"/repos/{self.repo}/git/blobs",
                                json={"content": b64, "encoding": "base64"}), "上传文件")
                tree_entries.append({"path": path, "mode": "100644",
                                     "type": "blob", "sha": resp.json()["sha"]})

            resp = self._ok(self._req(c, "POST", f"/repos/{self.repo}/git/trees",
                            json={"tree": tree_entries, "base_tree": base_tree}),
                            "构建文件树")
            tree_sha = resp.json()["sha"]

            resp = self._ok(self._req(
                c, "POST", f"/repos/{self.repo}/git/commits",
                json={"tree": tree_sha, "parents": [parent_sha],
                      "message": message}), "创建提交")
            commit_sha = resp.json()["sha"]

            resp = self._req(c, "PATCH",
                             f"/repos/{self.repo}/git/refs/heads/{self.branch}",
                             json={"sha": commit_sha, "force": False})
            if resp.status_code == 422:
                raise ProviderError("远端有新提交（并发冲突），请重试同步")
            if resp.is_error:
                raise ProviderError(f"更新分支失败：HTTP {resp.status_code}")

            owner, name = self.repo.split("/", 1)
            return f"https://github.com/{owner}/{name}/commit/{commit_sha}"

    def _bootstrap_empty_repo(self, c: httpx.Client) -> None:
        """空仓库没有任何 commit，Git Data API 连 blob 都无法创建。
        Contents API 是 GitHub 官方推荐的初始化入口：放一个占位文件制造第一个 commit。"""
        content = base64.b64encode(b"tt-calendar sync bootstrap").decode("ascii")
        self._ok(self._req(c, "PUT",
                 f"/repos/{self.repo}/contents/.tt-calendar-sync",
                 json={"message": "init: bootstrap empty repository",
                       "content": content}),
                 "初始化空仓库")


def encode_files(data: Data, tombstones: Tombstones, device: str) -> dict[str, str]:
    files: dict[str, str] = {
        "manifest.json": json.dumps(
            {"schema_version": SCHEMA_VERSION,
             "exported_at": _now(), "device": device},
            ensure_ascii=False, indent=1),
        "data/tombstones.json": json.dumps(
            {f"{t}|{k}": dt for (t, k), dt in sorted(tombstones.items())},
            ensure_ascii=False),
    }
    for table, rows in sorted(data.items()):
        files[f"data/{table}.json"] = json.dumps(
            {"rows": sorted(rows, key=lambda r: json.dumps(r, sort_keys=True, ensure_ascii=False))},
            ensure_ascii=False)
    return files


def _now() -> str:
    from datetime import datetime
    return datetime.now().isoformat(timespec="seconds")
