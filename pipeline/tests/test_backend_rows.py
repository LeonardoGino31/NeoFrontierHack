"""Convivencia con las filas `candidate_only` del backend (sin red)."""

import csv
import json
import tempfile
import unittest
from pathlib import Path

from pipeline.output import apply_to_csv
from pipeline.search import _known_analogs
from pipeline.sites import load_sites
from pipeline.targets import BACKEND_ORIGIN, _from_backend, _from_csv

FIELDS = ["pair_id", "earth_site_id", "candidate_id", "body", "earth_site_name", "earth_latitude",
          "earth_longitude", "analog_site_name", "analog_latitude", "analog_longitude", "data_status",
          "relief_earth", "relief_analog", "record_type", "candidate_status", "candidate_eligible",
          "candidate_overall_score", "candidate_filter_status"]
PAIR = {"pair_id": "salda-jezero", "earth_site_id": "salda", "candidate_id": "jezero", "body": "mars",
        "earth_site_name": "Lago Salda", "earth_latitude": "37.55", "earth_longitude": "29.68",
        "analog_site_name": "Cráter Jezero", "analog_latitude": "18.38", "analog_longitude": "77.58",
        "data_status": "demo_fijo", "relief_earth": "1960", "relief_analog": "600", "record_type": ""}
CANDIDATE = {"candidate_id": "moon-alt-0001", "body": "moon",
             "analog_site_name": "Candidato lunar · moon-alt-0001", "analog_latitude": "-82.3",
             "analog_longitude": "-22.5", "data_status": "passed_but_too_close", "relief_analog": "374.0",
             "record_type": "candidate_only", "candidate_status": "passed_but_too_close",
             "candidate_eligible": "true", "candidate_overall_score": "45.85",
             "candidate_filter_status": "partial"}


def _feature(cid: str, body: str, eligible: bool, score: float) -> dict:
    """Punto GeoJSON con las propiedades que escribe el backend."""
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [10.0, -5.0]},
            "properties": {"candidate_id": cid, "body": body, "candidate_status": "selected",
                           "eligible": eligible, "overall_score": score, "filter_status": "partial"}}


class BackendRowsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.csv = self.tmp / "candidates.csv"
        with self.csv.open("w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=FIELDS, lineterminator="\n")
            writer.writeheader()
            writer.writerows([PAIR, CANDIDATE])

    def test_sites_skip_candidate_rows(self):
        self.assertEqual([s.id for s in load_sites(self.csv)], ["salda", "jezero"])

    def test_known_analogs_skip_candidate_rows(self):
        self.assertEqual(list(_known_analogs(self.csv, self.tmp / "sin_archivo.json")), ["jezero"])

    def test_known_analogs_file_wins_over_csv(self):
        known = self.tmp / "known.json"
        known.write_text(json.dumps({"pairs": [{"earthId": "devon", "earthName": "Devon", "earthLat": 75.0,
                                                "earthLon": -89.0, "analogId": "utopia"}]}), encoding="utf-8")
        self.assertEqual(list(_known_analogs(self.csv, known)), ["utopia"])

    def test_apply_keeps_backend_values(self):
        values = self.tmp / "values.json"
        metric = {"value": 999, "unit": "m"}
        values.write_text(json.dumps({"sites": {
            "mars:jezero": {"metrics": {"relief": metric}},
            "moon:moon-alt-0001": {"metrics": {"relief": metric}}}}), encoding="utf-8")
        self.assertEqual(apply_to_csv(values, self.csv), 1)
        with self.csv.open(encoding="utf-8", newline="") as f:
            pair, candidate = list(csv.DictReader(f))
        self.assertEqual((pair["relief_analog"], pair["data_status"]), ("999", "medido_parcial"))
        self.assertEqual((candidate["relief_analog"], candidate["data_status"]), ("374.0", "passed_but_too_close"))

    def test_csv_candidates_become_targets(self):
        targets = {t["id"]: t for t in _from_csv(self.csv)}
        self.assertEqual(targets["jezero"]["origin"], "Sitio objetivo de la app (CSV)")
        backend = targets["moon-alt-0001"]
        self.assertEqual(backend["origin"], BACKEND_ORIGIN)
        self.assertEqual((backend["lat"], backend["backend"]["overallScore"]), (-82.3, 45.85))

    def test_geojson_keeps_best_eligible_per_body(self):
        path = self.tmp / "mars.geojson"
        path.write_text(json.dumps({"type": "FeatureCollection", "features": [
            _feature("a", "mars", False, 90), _feature("b", "mars", True, 40),
            _feature("c", "mars", True, 70)]}), encoding="utf-8")
        picked = _from_backend({"files": [str(path), str(self.tmp / "missing.geojson")], "maxPerBody": 2})
        self.assertEqual([t["id"] for t in picked], ["c", "b"])
        self.assertEqual((picked[0]["lat"], picked[0]["lon"]), (-5.0, 10.0))


if __name__ == "__main__":
    unittest.main()
