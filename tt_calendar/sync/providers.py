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
        """404 原样返回（空仓库的 ref/树查询依赖它），调用方自行解释。"""
        resp = client.request(method, path, **kw)
        if resp.status_code == 401:
            raise ProviderError("PAT 无效或过期（401）")
        if resp.status_code in (403, 429):
            raise ProviderError("触发 GitHub 限流（403/429），稍后重试")
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
                return {"ok": True,
                        "detail": f"连通正常（{self.repo}，{vis}，默认分支 {info.get('default_branch')}）"}
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
            if resp.status_code == 404:
                return None
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

    def push(self, files: dict[str, str], message: str, parent_tree_sha: str | None) -> str:
        """files: {path: json 文本}。返回新 commit html_url。parent_tree_sha 用于 base_tree。"""
        if not files:
            raise ProviderError("没有可推送的变更")
        with self._client() as c:
            resp = self._req(c, "GET", f"/repos/{self.repo}/git/ref/heads/{self.branch}")
            if resp.status_code == 404:
                parent_sha = None
                base_tree = None
            else:
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

            body: dict = {"tree": tree_entries}
            if base_tree:
                body["base_tree"] = base_tree
            resp = self._ok(self._req(c, "POST", f"/repos/{self.repo}/git/trees", json=body),
                            "构建文件树")
            tree_sha = resp.json()["sha"]

            resp = self._ok(self._req(
                c, "POST", f"/repos/{self.repo}/git/commits",
                json={"tree": tree_sha,
                      "parents": [parent_sha] if parent_sha else [],
                      "message": message}), "创建提交")
            commit_sha = resp.json()["sha"]

            if parent_sha:
                resp = self._req(c, "PATCH",
                                 f"/repos/{self.repo}/git/refs/heads/{self.branch}",
                                 json={"sha": commit_sha, "force": False})
                if resp.status_code == 422:
                    raise ProviderError("远端有新提交（并发冲突），请重试同步")
                if resp.is_error:
                    raise ProviderError(f"更新分支失败：HTTP {resp.status_code}")
            else:
                # 空仓库：分支 ref 尚不存在，走创建而非更新
                resp = self._req(c, "POST", f"/repos/{self.repo}/git/refs",
                                 json={"ref": f"refs/heads/{self.branch}",
                                       "sha": commit_sha})
                if resp.is_error:
                    detail = resp.json().get("message", resp.status_code)
                    raise ProviderError(f"创建分支失败：{detail}")
            owner, name = self.repo.split("/", 1)
            return f"https://github.com/{owner}/{name}/commit/{commit_sha}"


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
