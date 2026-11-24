"""同步通道抽象 + GitHub / Gitee 实现（都走 HTTP API，无需本地 git 二进制）。

两种后端对「快照怎么摆」的选择不同，但对 engine 暴露的接口完全一致
（`fetch()` / `push(files, message)` / `test()`）：

- GitHub：Git Data API，快照摊成多文件树
      manifest.json
      data/{table}.json          {"rows":[...]}
      data/tombstones.json       {"table|key": deleted_at}
- Gitee：Contents API，快照打成单个 gzip 文件（`ttc-sync.bin.gz`）
  一次 PUT 即一个 commit，天然原子；代价是每次全量上传（数据量只有几百 KB，
  压缩后更小，比「6+N 次请求、中途失败留下半新半旧」划算得多）。
"""

import base64
import gzip
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


# ---------------------------------------------------------------- Gitee


GITEE_API = "https://gitee.com/api/v5"
# 单文件快照的落盘名。带扩展名是 Gitee contents API 的硬要求（无扩展名会报错）。
GITEE_SNAPSHOT_PATH = "ttc-sync.bin.gz"


def encode_blob(files: dict[str, str]) -> bytes:
    """多文件快照 → 单个 gzip 字节流。

    压一层的原因不是省空间（快照本来就不大），而是避开 contents API 的
    「正文超过 1MB 时 content 字段返回空」这条限制：几 MB 的 JSON 压完通常
    只有几百 KB，读取路径就不用每次都退到 raw 接口。
    """

    payload = json.dumps(
        {"format": 1, "schema_version": SCHEMA_VERSION, "files": files},
        ensure_ascii=False,
    ).encode("utf-8")
    return gzip.compress(payload, 6)


def decode_blob(raw: bytes) -> dict[str, str]:
    if raw[:2] == b"\x1f\x8b":
        try:
            raw = gzip.decompress(raw)
        except OSError as e:
            raise ProviderError(f"远端快照解压失败：{e}")
    try:
        obj = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise ProviderError(f"远端快照不是本应用写的（无法解析）：{e}")
    files = obj.get("files") if isinstance(obj, dict) else None
    if not isinstance(files, dict) or not files:
        raise ProviderError("远端快照缺少 files 字段，可能被其他程序覆盖过")
    return {str(k): str(v) for k, v in files.items()}


def files_to_snapshot(files: dict[str, str], version: str) -> Snapshot:
    """把 encode_files 的产物解回 (data, tombstones)。

    与 GitHubProvider.fetch 里的解析口径必须一致，否则跨后端互相同步会丢表。
    """

    data: Data = {}
    tombstones: Tombstones = {}
    for path, text in files.items():
        if path == "manifest.json":
            continue
        if not path.startswith("data/") or not path.endswith(".json"):
            continue
        name = path[len("data/"):-len(".json")]
        try:
            payload = json.loads(text)
        except json.JSONDecodeError as e:
            raise ProviderError(f"远端文件 {path} 解析失败：{e}")
        if name == "tombstones":
            for combined, dt in (payload or {}).items():
                table, key = combined.split("|", 1)
                tombstones[(table, key)] = dt
        else:
            data[name] = (payload or {}).get("rows", [])
    return Snapshot(data, tombstones, version)


class GiteeProvider:
    """Gitee（码云）私有仓库同步通道。

    认证用「私人令牌」（gitee.com/profile/personal_access_tokens），scope 至少
    要勾 projects（仓库读写）。令牌按官方最常见的形式放在 query 参数里——
    Gitee 的 OAuth 支持 Bearer，但私人令牌走 query 的兼容性最好。
    """

    def __init__(self, repo: str, token: str, branch: str = "main",
                 transport: httpx.BaseTransport | None = None):
        self.repo = repo.strip().strip("/")
        self.token = token.strip()
        self.branch = branch.strip() or "main"
        self._transport = transport

    def _client(self) -> httpx.Client:
        if not self.token:
            raise ProviderError("未配置私人令牌")
        return httpx.Client(
            base_url=GITEE_API,
            headers={"Accept": "application/json"},
            timeout=TIMEOUT,
            transport=self._transport,
        )

    def _req(self, client: httpx.Client, method: str, path: str, **kw) -> httpx.Response:
        params = dict(kw.pop("params", None) or {})
        params["access_token"] = self.token
        resp = client.request(method, path, params=params, **kw)
        if resp.status_code == 401:
            raise ProviderError(
                "Gitee 私人令牌无效或过期（401），请到 "
                "gitee.com/profile/personal_access_tokens 重新生成后填入")
        if resp.status_code == 403:
            body = _safe_json(resp)
            detail = body.get("message") or body.get("error_description") or ""
            raise ProviderError(
                f"Gitee 拒绝访问（403）：{detail or '令牌缺少 projects 权限，或触发限流'}")
        if resp.status_code == 429:
            raise ProviderError("触发 Gitee 限流，请稍后重试")
        return resp

    def _ok(self, resp: httpx.Response, action: str) -> httpx.Response:
        if resp.is_error:
            body = _safe_json(resp)
            detail = body.get("message") or body.get("error_description") or f"HTTP {resp.status_code}"
            if resp.status_code == 400 and "branch" in str(detail).lower():
                raise ProviderError(
                    f"{action}失败：分支 {self.branch} 不存在。请先在该仓库里建好分支，"
                    "或把设置里的分支改成 main / master")
            raise ProviderError(f"{action}失败：{detail}")
        return resp

    def test(self) -> dict:
        try:
            with self._client() as c:
                resp = self._req(c, "GET", "/user")
                self._ok(resp, "校验令牌")
                who = str((resp.json() or {}).get("login") or "?")

                resp = self._req(c, "GET", f"/repos/{self.repo}")
                if resp.status_code == 404:
                    return {"ok": False, "detail": (
                        f"仓库 {self.repo} 不存在，或该令牌无权访问。请确认令牌勾选了 "
                        "projects 权限，且仓库是「私有」而不是别人的")}
                if resp.is_error:
                    return {"ok": False, "detail": f"HTTP {resp.status_code}"}
                info = resp.json() or {}
                vis = "私有" if info.get("private") else "公开"
                warn = "" if info.get("private") else "；警告：公开仓库会让日历数据对所有人可见"
                # Gitee 新仓库默认分支常常是 master，而设置里默认填 main。
                # 分支不一致时同步会以「分支不存在」失败，这里提前点出来，
                # 省掉一轮「测试通过但同步失败」的排查。
                default_branch = str(info.get("default_branch") or "")
                branch_hint = ""
                if default_branch and default_branch != self.branch:
                    branch_hint = f"；注意：仓库默认分支是 {default_branch}，请把分支改成它"
                return {"ok": True, "detail": (
                    f"连通正常（{self.repo}，{vis}，账号 {who}）。若同步仍报权限不足，"
                    f"请确认令牌勾选了 projects（仓库）权限{warn}{branch_hint}）")}
        except ProviderError as e:
            return {"ok": False, "detail": str(e)}
        except (httpx.HTTPError, socket.error) as e:
            return {"ok": False, "detail": f"网络错误：{e}"}

    def _raw(self, c: httpx.Client) -> bytes:
        """contents 的正文超过 1MB 时 content 是空串，退回 raw 接口取原始字节。"""
        resp = self._req(c, "GET",
                         f"/repos/{self.repo}/raw/{GITEE_SNAPSHOT_PATH}",
                         params={"ref": self.branch})
        self._ok(resp, "下载快照")
        return resp.content

    def fetch(self) -> Snapshot | None:
        """拉远端快照；还没同步过（文件不存在）返回 None。"""

        with self._client() as c:
            resp = self._req(c, "GET", f"/repos/{self.repo}")
            if resp.status_code == 404:
                raise ProviderError(
                    f"令牌无法访问仓库 {self.repo}（404）。请到 "
                    "gitee.com/profile/personal_access_tokens 确认令牌勾选了 projects 权限，"
                    "并确认仓库名拼写（owner/repo）")
            self._ok(resp, "访问仓库")

            resp = self._req(c, "GET",
                             f"/repos/{self.repo}/contents/{GITEE_SNAPSHOT_PATH}",
                             params={"ref": self.branch})
            if resp.status_code == 404:
                return None
            self._ok(resp, "读取快照")
            # Gitee 的 contents 接口对「文件不存在」**不一定**回 404：实测
            # `/contents/<path>` 会返回 `200 []`（空数组），只有 raw 才 404。
            # 早先只判 404，于是首次同步永远拿不到 None、直接掉进 `_raw()` 报
            # 「下载快照失败：path」，新仓库一辈子推不上第一份快照。
            # 现在同时兜住两种形态：非 dict、或缺 sha，都算「远端还没有快照」。
            meta = resp.json() or {}
            if not isinstance(meta, dict) or not meta.get("sha"):
                return None
            version = str(meta.get("sha") or "")
            content = meta.get("content") or ""
            if content:
                try:
                    raw = base64.b64decode("".join(str(content).split()))
                except (ValueError, TypeError) as e:
                    raise ProviderError(f"远端快照解码失败：{e}")
            else:
                raw = self._raw(c)
            return files_to_snapshot(decode_blob(raw), version)

    def push(self, files: dict[str, str], message: str) -> str:
        """把整份快照写回仓库。返回 commit 链接。

        sha 就是乐观锁：读到的 sha 与远端当前不一致时 Gitee 会拒绝（409/422），
        这里翻译成「并发冲突」，engine 收到后会重新拉取合并再试一次。
        """

        if not files:
            raise ProviderError("没有可推送的变更")
        b64 = base64.b64encode(encode_blob(files)).decode("ascii")

        with self._client() as c:
            resp = self._req(c, "GET",
                             f"/repos/{self.repo}/contents/{GITEE_SNAPSHOT_PATH}",
                             params={"ref": self.branch})
            sha = ""
            if resp.status_code == 200:
                sha = str((resp.json() or {}).get("sha") or "")
            elif resp.status_code != 404:
                self._ok(resp, "读取远端快照版本")

            body = {"content": b64, "message": message, "branch": self.branch}
            if sha:
                body["sha"] = sha
            method = "PUT" if sha else "POST"
            path = f"/repos/{self.repo}/contents/{GITEE_SNAPSHOT_PATH}"
            resp = self._req(c, method, path, json=body)
            if resp.status_code == 400 and not _safe_json(resp).get("message"):
                # Gitee 的 contents 接口在部分网关实现上只认表单编码（json body
                # 会被忽略 → 400 且没有 message）。降级重发一次；如果这次仍然失败，
                # 下面的 _ok 会带着服务端原文报错，不会掩盖真正的原因。
                resp = self._req(c, method, path, data=body)
            if resp.status_code in (409, 422):
                raise ProviderError("并发冲突：远端快照已被其他设备更新，请重试同步")
            self._ok(resp, "上传快照")
            commit = (resp.json() or {}).get("commit") or {}
            return f"https://gitee.com/{self.repo}/commit/{commit.get('sha', '')}"

