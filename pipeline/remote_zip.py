"""Extrae archivos sueltos de un zip remoto sin descargarlo entero.

El zip de la base de datos de SIM 3292 (mapa geológico de Marte) pesa ~800 MB, casi todo
en sombreados de relieve; el shapefile de unidades ocupa ~55 MB. Con peticiones HTTP
`Range` se lee el índice del zip y luego solo los miembros pedidos.
"""

import io
import shutil
import zipfile
from pathlib import Path

import requests

CHUNK = 1 << 20


class _HttpRangeFile(io.RawIOBase):
    """Archivo de solo lectura sobre una URL que acepta peticiones `Range`."""

    def __init__(self, url: str):
        """Abre la URL y averigua su tamaño."""
        super().__init__()
        self.url, self.pos = url, 0
        head = requests.head(url, allow_redirects=True, timeout=60)
        head.raise_for_status()
        self.size = int(head.headers["content-length"])

    def readable(self) -> bool:
        """Siempre legible."""
        return True

    def seekable(self) -> bool:
        """`zipfile` necesita saltar al índice del final."""
        return True

    def tell(self) -> int:
        """Posición actual."""
        return self.pos

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        """Mueve la posición como un archivo local."""
        base = {io.SEEK_SET: 0, io.SEEK_CUR: self.pos, io.SEEK_END: self.size}[whence]
        self.pos = base + offset
        return self.pos

    def readinto(self, buffer) -> int:
        """Pide al servidor solo el rango que cabe en `buffer`."""
        if self.pos >= self.size:
            return 0
        end = min(self.size, self.pos + len(buffer)) - 1
        response = requests.get(self.url, headers={"Range": f"bytes={self.pos}-{end}"}, timeout=120)
        response.raise_for_status()
        data = response.content
        buffer[: len(data)] = data
        self.pos += len(data)
        return len(data)


def extract(url: str, members: list[str], dest: Path) -> list[Path]:
    """Guarda en `dest` los miembros indicados (por nombre de archivo, sin carpeta); omite los ya presentes."""
    dest.mkdir(parents=True, exist_ok=True)
    wanted = {m: dest / m for m in members if not (dest / m).exists()}
    if wanted:
        with zipfile.ZipFile(io.BufferedReader(_HttpRangeFile(url), buffer_size=CHUNK)) as archive:
            for info in archive.infolist():
                name = info.filename.rsplit("/", 1)[-1]
                if name in wanted:
                    print(f"  · extrayendo {name} ({info.compress_size / 1e6:.0f} MB)")
                    tmp = wanted[name].with_suffix(wanted[name].suffix + ".part")
                    with archive.open(info) as src, tmp.open("wb") as out:
                        shutil.copyfileobj(src, out, CHUNK)
                    tmp.rename(wanted[name])
        missing = [m for m in wanted if not wanted[m].exists()]
        if missing:
            raise FileNotFoundError(f"no están en el zip: {', '.join(missing)}")
    return [dest / m for m in members]
