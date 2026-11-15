import csv, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from core.features import load_model
from core.similarity import score

class Parity(unittest.TestCase):
    def setUp(self):
        self.model = load_model()
        with open(ROOT / "public/data/planetary_candidates.csv", encoding="utf-8") as f:
            self.rows = list(csv.DictReader(f))

    def values(self, row, side):
        out = {}
        for p in self.model["parameters"]:
            raw = row[p["columns"][side]]
            if raw != "":
                out[p["key"]] = float(raw)
        return out

    def test_range(self):
        for r in self.rows:
            s = score(self.values(r, "earth"), self.values(r, "analog"), self.model, r["body"])
            self.assertTrue(0 <= s["overall"] <= 1, r["pair_id"])

    def test_identical_is_one(self):
        r = self.rows[0]
        v = self.values(r, "earth")
        self.assertAlmostEqual(score(v, v, self.model, r["body"])["overall"], 1.0)

if __name__ == "__main__":
    unittest.main()
