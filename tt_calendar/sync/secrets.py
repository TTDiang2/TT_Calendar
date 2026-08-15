"""Windows DPAPI 保护同步凭据（PAT）。

CryptProtectData 默认按「当前用户 + 本机」加密：换用户/换机器无法解密。
每台设备各自填各自的 PAT，正好匹配这个语义（PAT 从不参与同步）。
"""

import ctypes
import ctypes.wintypes as wt

_crypt32 = ctypes.WinDLL("crypt32.dll")
_kernel32 = ctypes.WinDLL("kernel32.dll")


class _DATA_BLOB(ctypes.Structure):
    _fields_ = [("cbData", wt.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _blob(data: bytes) -> _DATA_BLOB:
    buf = ctypes.create_string_buffer(data, len(data))
    return _DATA_BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))


def _unblob(blob: _DATA_BLOB) -> bytes:
    try:
        return ctypes.string_at(blob.pbData, blob.cbData)
    finally:
        _kernel32.LocalFree(ctypes.cast(blob.pbData, wt.HGLOBAL))


def protect(data: str, entropy: str = "tt-calendar-sync") -> str:
    """加密，返回 base64（可存 SQLite TEXT 列）。"""
    import base64
    if not data:
        return ""
    inb = _blob(data.encode("utf-8"))
    ent = _blob(entropy.encode("utf-8"))
    outb = _DATA_BLOB()
    if not _crypt32.CryptProtectData(ctypes.byref(inb), None, ctypes.byref(ent), None,
                                     None, 0, ctypes.byref(outb)):
        raise OSError("CryptProtectData failed")
    return base64.b64encode(_unblob(outb)).decode("ascii")


def unprotect(token_b64: str, entropy: str = "tt-calendar-sync") -> str:
    """解密 protect() 的产物。"""
    import base64
    if not token_b64:
        return ""
    inb = _blob(base64.b64decode(token_b64))
    ent = _blob(entropy.encode("utf-8"))
    outb = _DATA_BLOB()
    if not _crypt32.CryptUnprotectData(ctypes.byref(inb), None, ctypes.byref(ent), None,
                                       None, 0, ctypes.byref(outb)):
        raise OSError("CryptUnprotectData failed（换了用户或机器？请重新填写 PAT）")
    return _unblob(outb).decode("utf-8")
