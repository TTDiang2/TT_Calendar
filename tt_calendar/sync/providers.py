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
    def __init__(self, repo: str, token: str, branch: str = "main"):
        self.repo = repo.strip().strip("/")
        self.token = token.strip()
        self.branch = branch.strip() or "main"

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
        )

    def _req(self, client: httpx.Client, method: str, path: str, **kw) -> httpx.Response:
        resp = client.request(method, path, **kw)
        if resp.status_code == 401:
            raise ProviderError("PAT 无效或过期（401）")
        if resp.status_code == 404:
            raise ProviderError(f"仓库/分支不存在或无权限：{self.repo}#{self.branch}")
        if resp.status_code in (403, 429):
            raise ProviderError("触发 GitHub 限流（403/429），稍后重试")
        return resp

    def test(self) -> dict:
        try:
            with self._client() as c:
                resp = self._req(c, "GET", f"/repos/{self.repo}")
                if resp.status_code != 200:
                    return {"ok": False, "detail": f"HTTP {resp.status_code}"}
                info = resp.json()
                vis = info.get("visibility", "?")
                return {"ok": True,
                        "detail": f"连通正常（{self.repo}，{vis}，默认分支 {info.get('default_branch')}）"}
        except ProviderError as e:
            return {"ok": False, "detail": str(e)}
        except (httpx.HTTPError, socket.error) as e:
            return {"ok": False, "detail": f"网络错误：{e}"}

    def fetch(self) -> Snapshot | None:
        """拉远端快照；仓库/分支无任何提交时返回 None（首次初始化）。"""
        with self._client() as c:
            resp = self._req(c, "GET", f"/repos/{self.repo}/git/ref/heads/{self.branch}")
            if resp.status_code == 404:
                return None
            head = resp.json()["object"]["sha"]

            resp = self._req(c, "GET", f"/repos/{self.repo}/git/trees/{head}?recursive=1")
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
        resp = self._req(c, "GET", f"/repos/{self.repo}/git/blobs/{sha}")
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
                resp = self._req(c, "GET", f"/repos/{self.repo}/git/commits/{parent_sha}")
                base_tree = resp.json()["tree"]["sha"]

            tree_entries = []
            for path, text in files.items():
                b64 = base64.b64encode(text.encode("utf-8")).decode("ascii")
                resp = self._req(c, "POST", f"/repos/{self.repo}/git/blobs",
                                 json={"content": b64, "encoding": "base64"})
                tree_entries.append({"path": path, "mode": "100644",
                                     "type": "blob", "sha": resp.json()["sha"]})

            body: dict = {"tree": tree_entries}
            if base_tree:
                body["base_tree"] = base_tree
            resp = self._req(c, "POST", f"/repos/{self.repo}/git/trees", json=body)
            tree_sha = resp.json()["sha"]

            resp = self._req(
                c, "POST", f"/repos/{self.repo}/git/commits",
                json={"tree": tree_sha,
                      "parents": [parent_sha] if parent_sha else [],
                      "message": message})
            commit_sha = resp.json()["sha"]

            resp = self._req(c, "PATCH",
                             f"/repos/{self.repo}/git/refs/heads/{self.branch}",
                             json={"sha": commit_sha, "force": False})
            if resp.status_code == 422:
                raise ProviderError("远端有新提交（并发冲突），请重试同步")
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
