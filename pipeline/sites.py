"""Sitios a medir, leídos del CSV de parejas Tierra–análogo que usa la app."""

import csv
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Site:
    """Un punto a medir. La ventana la decide el cuerpo del análogo de su pareja."""

    id: str
    body: str          # cuerpo donde está el punto: earth, mars o moon
    pair_body: str     # cuerpo del análogo de la pareja: fija ventana y resolución
    name: str
    lat: float
    lon: float


def load_sites(csv_path: Path) -> list[Site]:
    """Puntos de la Tierra y análogos únicos del CSV, en el orden en que aparecen."""
    sites: dict[str, Site] = {}
    with csv_path.open(encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            body = row["body"]
            earth = Site(row["earth_site_id"], "earth", body, row["earth_site_name"],
                         float(row["earth_latitude"]), float(row["earth_longitude"]))
            analog = Site(row["candidate_id"], body, body, row["analog_site_name"],
                          float(row["analog_latitude"]), float(row["analog_longitude"]))
            # Un análogo puede repetirse en varias parejas (Gale): se mide una sola vez
            for site in (earth, analog):
                sites.setdefault(f"{site.body}:{site.id}", site)
    return list(sites.values())
