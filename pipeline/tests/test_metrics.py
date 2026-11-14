"""Pruebas de los cálculos con datos sintéticos (sin red): python -m unittest discover pipeline/tests"""

import unittest

import numpy as np

from pipeline.metrics import (annual_sunlit_pct, ice_index, moon_near_side_earth_view_pct, relief_m,
                              safe_slope_pct, slope_deg, slope_limit_deg)

LIMITS = [{"maxResolutionM": 120, "limitDeg": 15}, {"maxResolutionM": 100000, "limitDeg": 5}]


class TopographyTest(unittest.TestCase):
    def test_flat_plane_has_no_relief_and_is_all_safe(self):
        dem = np.full((40, 40), 1234.0)
        self.assertEqual(relief_m(dem), 0)
        self.assertEqual(safe_slope_pct(slope_deg(dem, 100), 15), 100)

    def test_ramp_of_45_degrees_is_never_safe(self):
        dem = np.tile(np.arange(40) * 100.0, (40, 1))  # sube 100 m cada 100 m
        slopes = slope_deg(dem, 100)
        self.assertAlmostEqual(float(np.nanmean(slopes)), 45, places=5)
        self.assertEqual(safe_slope_pct(slopes, 15), 0)

    def test_relief_ignores_a_single_spike(self):
        dem = np.zeros((50, 50))
        dem[0, 0] = 10000
        self.assertEqual(relief_m(dem), 0)

    def test_nan_pixels_are_ignored(self):
        dem = np.zeros((10, 10))
        dem[:5] = np.nan
        self.assertEqual(safe_slope_pct(slope_deg(dem, 100), 15), 100)

    def test_slope_limit_depends_on_resolution(self):
        self.assertEqual(slope_limit_deg(120, LIMITS), 15)
        self.assertEqual(slope_limit_deg(463, LIMITS), 5)


class IlluminationTest(unittest.TestCase):
    def test_equator_is_lit_half_the_time(self):
        self.assertAlmostEqual(annual_sunlit_pct(0, 23.44), 50, places=5)

    def test_poles_average_half_over_a_year(self):
        # Medio año de día y medio año de noche
        self.assertAlmostEqual(annual_sunlit_pct(89.9, 25.19), 50, delta=1)

    def test_earth_view_by_hemisphere(self):
        self.assertEqual(moon_near_side_earth_view_pct(14.09, -56.8), 100)  # Marius
        self.assertEqual(moon_near_side_earth_view_pct(0, 180), 0)          # cara oculta


class IceTest(unittest.TestCase):
    def test_index_and_confidence(self):
        index, confidence = ice_index({"a": True, "b": None}, ["a", "b", "c"])
        self.assertEqual(index, 100)
        self.assertAlmostEqual(confidence, 100 / 3)

    def test_no_indicators_returns_none(self):
        self.assertIsNone(ice_index({}, ["a"]))


if __name__ == "__main__":
    unittest.main()
