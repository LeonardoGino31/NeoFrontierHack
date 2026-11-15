"""Vocabulario litológico, puntuación de la búsqueda y selección de candidatos (sin red)."""

import json
import unittest
from pathlib import Path

import numpy as np

from pipeline import geology
from pipeline.candidates import pick
from pipeline.search import _score, validation_summary

MODEL = json.loads(Path("public/data/parameter_model.json").read_text(encoding="utf-8"))


class VocabularyTest(unittest.TestCase):
    def test_every_class_in_mappings_exists(self):
        keys = set(geology.class_keys())
        for body, rules in geology.table()["bodies"].items():
            mapped = rules.get("glim", {}) | rules.get("units", {})
            self.assertTrue(set(v for v in mapped.values() if v) <= keys, body)
        for target, row in geology.table()["affinity"].items():
            self.assertIn(target, keys)
            self.assertTrue(set(row) <= keys, target)

    def test_affinity_is_one_on_the_diagonal_and_bounded(self):
        for key in geology.class_keys():
            lut = geology.affinity_lut(key)
            self.assertEqual(lut[geology.class_code(key)], 1.0)
            self.assertTrue(np.all((lut[1:] >= 0) & (lut[1:] <= 1)))

    def test_known_units_map_as_expected(self):
        self.assertEqual(geology.unit_class("moon", "Im2"), "basalt")
        self.assertEqual(geology.unit_class("moon", "pNt"), "anorthositicCrust")
        self.assertEqual(geology.unit_class("mars", "HNt"), "clasticSedimentary")
        self.assertEqual(geology.unit_class("mars", "Ave"), "basalt")
        self.assertIsNone(geology.unit_class("mars", "desconocida"))

    def test_similarity_is_nan_without_earth_data(self):
        codes = np.array([geology.class_code("basalt"), np.nan, geology.class_code("ice")], dtype="float32")
        sim = geology.similarity(codes, "basalt")
        self.assertEqual(sim[0], 1.0)
        self.assertTrue(np.isnan(sim[1]))
        self.assertEqual(sim[2], 0.0)


class ScoreTest(unittest.TestCase):
    def setUp(self):
        basalt, sand = geology.class_code("basalt"), geology.class_code("unconsolidated")
        self.layers = {"relief": np.array([100.0, 100.0]), "sunlight": np.array([45.0, 45.0]),
                       "lithology": np.array([basalt, sand], dtype="float32")}
        self.target = {"relief": 100.0, "sunlight": 50.0, "lithology": "basalt"}

    def test_geology_separates_cells_with_equal_terrain(self):
        score, used = _score(self.target, self.layers, MODEL, "mars")
        self.assertGreater(score[0], score[1])
        self.assertIn("lithology", used)

    def test_cells_without_lithology_stay_in_but_get_no_advantage(self):
        basalt, sand = geology.class_code("basalt"), geology.class_code("unconsolidated")
        self.layers = {k: np.repeat(v[:1], 3) for k, v in self.layers.items()}
        self.layers["lithology"] = np.array([basalt, sand, np.nan], dtype="float32")
        score, _ = _score(self.target, self.layers, MODEL, "mars")
        self.assertTrue(np.isfinite(score[2]))
        self.assertGreater(score[0], score[2])
        self.assertGreater(score[2], score[1])

    def test_mars_search_skips_sunlight_but_previous_method_keeps_it(self):
        _, used = _score(self.target, self.layers, MODEL, "mars")
        self.assertNotIn("sunlight", used)
        _, used_prev = _score(self.target, self.layers, MODEL, "mars", use_geology=False, exclude=())
        self.assertEqual(sorted(used_prev), ["relief", "sunlight"])


class ValidationSummaryTest(unittest.TestCase):
    def test_reports_median_percentile_per_method(self):
        results = [{"id": "t", "name": "T", "body": "mars", "targetValues": {"lithology": "basalt"},
                    "knownAnalogs": [{"id": "e", "name": "E",
                                      "previous": {"topPct": 80.0, "rank": 8, "of": 10},
                                      "current": {"topPct": 10.0, "rank": 1, "of": 10}}]}]
        summary = validation_summary(results)
        self.assertEqual(summary["bodies"]["mars"]["previous"]["medianTopPct"], 80.0)
        self.assertEqual(summary["bodies"]["mars"]["current"]["inTop10Pct"], 1)


class PickTest(unittest.TestCase):
    @staticmethod
    def feature(cid, body, status, score, lat, lon):
        return {"geometry": {"coordinates": [lon, lat]},
                "properties": {"candidate_id": cid, "body": body, "candidate_status": status,
                               "overall_score": score}}

    def test_drops_duplicates_and_statuses_not_listed(self):
        features = [
            self.feature("sel", "moon", "selected", 45, -82.3, -22.1),
            self.feature("dup", "moon", "passed_but_too_close", 45.8, -82.3, -22.4),
            self.feature("near", "moon", "near_miss", 50, -82.29, -22.2),
            self.feature("far", "moon", "near_miss", 40, -81.3, -32.6),
        ]
        rules = {"statuses": ["selected", "near_miss"], "minSeparationKm": {"moon": 30, "mars": 300},
                 "maxPerBody": {"moon": 10, "mars": 12}}
        chosen = pick(features, rules, {"moon": 1737.4, "mars": 3396.19})
        self.assertEqual([f["properties"]["candidate_id"] for f in chosen], ["sel", "far"])


if __name__ == "__main__":
    unittest.main()
