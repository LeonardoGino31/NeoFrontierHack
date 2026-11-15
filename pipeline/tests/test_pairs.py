"""Elección del punto terrestre de cada pareja y limpieza de nombres de lugar (sin red)."""

import unittest

from pipeline.pairs import _latin, _pick


class PickTest(unittest.TestCase):
    def test_skips_candidates_near_points_already_used(self):
        target = {"candidates": [{"lat": -80.0, "lon": 120.0, "score": 0.99},
                                 {"lat": -80.2, "lon": 121.0, "score": 0.98},
                                 {"lat": -70.0, "lon": 10.0, "score": 0.95}]}
        pick, rank = _pick(target, chosen=[(-80.1, 120.5)], min_km=150)
        self.assertEqual((pick["lat"], rank), (-70.0, 3))

    def test_falls_back_to_best_when_all_are_near(self):
        target = {"candidates": [{"lat": 10.0, "lon": 10.0, "score": 0.9}]}
        self.assertEqual(_pick(target, chosen=[(10.0, 10.1)], min_km=150)[1], 1)


class LatinTest(unittest.TestCase):
    def test_keeps_latin_part_of_bilingual_names(self):
        self.assertEqual(_latin("Halfa - حلفا"), "Halfa")
        self.assertEqual(_latin("Kermán"), "Kermán")
        self.assertEqual(_latin("شهرستان سیرجان"), "")


if __name__ == "__main__":
    unittest.main()
