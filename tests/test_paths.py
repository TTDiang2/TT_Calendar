"""路径解析：环境变量 > 平台目录 > 仓库根。"""

from __future__ import annotations

import sys

from tt_calendar import paths


def test_home_from_env(monkeypatch, tmp_path):
    monkeypatch.setenv("TT_CALENDAR_HOME", str(tmp_path))
    assert paths.resolve_home() == tmp_path


def test_dev_home_is_repo_root(monkeypatch):
    monkeypatch.delenv("TT_CALENDAR_HOME", raising=False)
    monkeypatch.setattr(sys, "frozen", False, raising=False)
    assert paths.resolve_home() == paths.PROJECT_ROOT


def test_windows_home_uses_appdata(monkeypatch, tmp_path):
    monkeypatch.delenv("TT_CALENDAR_HOME", raising=False)
    monkeypatch.delenv("LOCALAPPDATA", raising=False)
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setenv("APPDATA", str(tmp_path))
    assert paths.resolve_home() == tmp_path / "TT Calendar"


def test_plugins_dir_uses_appdata_when_frozen(monkeypatch, tmp_path):
    monkeypatch.delenv("TT_CALENDAR_PLUGINS_DIR", raising=False)
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setenv("APPDATA", str(tmp_path))
    assert paths.resolve_plugins_dir(tmp_path) == tmp_path / "TT Calendar" / "plugins"


def test_plugins_dir_env_wins(monkeypatch, tmp_path):
    target = tmp_path / "custom-plugins"
    monkeypatch.setenv("TT_CALENDAR_PLUGINS_DIR", str(target))
    assert paths.resolve_plugins_dir(tmp_path) == target


def test_plugins_dir_dev_stays_in_repo(monkeypatch, tmp_path):
    monkeypatch.delenv("TT_CALENDAR_PLUGINS_DIR", raising=False)
    monkeypatch.setattr(sys, "frozen", False, raising=False)
    assert paths.resolve_plugins_dir(tmp_path) == tmp_path / "plugins"
