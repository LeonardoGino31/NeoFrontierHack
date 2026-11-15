"""Hielo con permafrost, suelo lunar y reparto de candidatos de la búsqueda (sin red)."""

import unittest

import numpy as np

from pipeline.earth.grid import combine_ice
from pipeline.search import _top_candidates
from pipeline.sources.diviner import rock_score


class CombineIceTest(unittest.TestCase):
    def test_permafrost_without_snow_counts_as_ice(self):
        earth = {"snow": np.array([0.0, 100.0, 20.0, np.nan], dtype="float32"),
                 "permafrost": np.array([90.0, np.nan, 10.0, np.nan], dtype="float32")}
        combine_ice(earth)
        np.testing.assert_array_equal(earth["ice"][:3], [90, 100, 20])
        self.assertTrue(np.isnan(earth["ice"][3]))

    def test_old_grid_keeps_snow_index(self):
        earth = {"ice": np.array([40.0], dtype="float32")}
        combine_ice(earth)
        np.testing.assert_array_equal(earth["snow"], [40])
        np.testing.assert_array_equal(earth["ice"], [40])


class RockScoreTest(unittest.TestCase):
    def test_scales_between_body_percentiles(self):
        self.assertEqual(rock_score(0.0, 0.0, 0.006), 0)
        self.assertEqual(rock_score(0.003, 0.0, 0.006), 50)
        self.assertEqual(rock_score(0.02, 0.0, 0.006), 100)


class TopCandidatesTest(unittest.TestCase):
    def test_fills_n_when_best_cells_cluster(self):
        # 2000 celdas pegadas en la misma región tienen el mejor puntaje; las regiones
        # lejanas, uno menor: con el grupo inicial (n × 400 = 800) solo saldría una.
        lat = np.zeros((1, 3000))
        lon = np.concatenate([np.linspace(0, 0.5, 2000), np.linspace(10, 150, 1000)])[None, :]
        score = np.concatenate([np.full(2000, 0.99), np.full(1000, 0.5)])[None, :]
        layers = {"relief": np.zeros((1, 3000))}
        out = _top_candidates(score, np.ones((1, 3000), bool), np.stack([lat, lon]), layers, ["relief"],
                              n=2, min_km=150)
        self.assertEqual(len(out), 2)
        self.assertEqual([c["score"] for c in out], [0.99, 0.5])


if __name__ == "__main__":
    unittest.main()
