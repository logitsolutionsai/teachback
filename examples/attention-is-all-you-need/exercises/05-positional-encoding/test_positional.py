import math
import unittest

from positional import add_positional_encoding, positional_encoding


class TestPositionalEncoding(unittest.TestCase):
    def assertRowAlmostEqual(self, got, want, places=9):
        self.assertEqual(len(got), len(want))
        for g, w in zip(got, want):
            self.assertAlmostEqual(g, w, places=places)

    def test_shape(self):
        pe = positional_encoding(5, 6)
        self.assertEqual((len(pe), len(pe[0])), (5, 6))

    def test_position_zero_alternates_zero_and_one(self):
        self.assertRowAlmostEqual(positional_encoding(1, 4)[0], [0.0, 1.0, 0.0, 1.0])

    def test_position_one_hand_computed(self):
        # d_model = 4: the second pair uses 10000 ** (2/4) = 100, so its angle is 1/100.
        self.assertRowAlmostEqual(positional_encoding(2, 4)[1], [math.sin(1), math.cos(1), math.sin(0.01), math.cos(0.01)])

    def test_each_pair_lies_on_the_unit_circle(self):
        for row in positional_encoding(7, 8):
            for i in range(0, 8, 2):
                self.assertAlmostEqual(row[i] ** 2 + row[i + 1] ** 2, 1.0, places=9)

    def test_odd_d_model_is_rejected(self):
        with self.assertRaises(ValueError):
            positional_encoding(3, 5)

    def test_offset_is_a_linear_map(self):
        # The paper's reason for sinusoids: PE(pos + k) is a linear function (a rotation) of PE(pos).
        d, k = 6, 3
        pe = positional_encoding(12, d)
        for pos in (0, 2, 5):
            for i in range(d // 2):
                w = 1 / 10000 ** (2 * i / d)
                s, c = pe[pos][2 * i], pe[pos][2 * i + 1]
                rotated = [s * math.cos(w * k) + c * math.sin(w * k), c * math.cos(w * k) - s * math.sin(w * k)]
                self.assertRowAlmostEqual(pe[pos + k][2 * i: 2 * i + 2], rotated)

    def test_add_positional_encoding(self):
        X = [[0.0, 0.0, 0.0, 0.0], [1.0, 1.0, 1.0, 1.0]]
        out = add_positional_encoding(X)
        self.assertRowAlmostEqual(out[0], [0.0, 1.0, 0.0, 1.0])
        self.assertRowAlmostEqual(out[1], [1 + math.sin(1), 1 + math.cos(1), 1 + math.sin(0.01), 1 + math.cos(0.01)])
        self.assertEqual(X[0], [0.0, 0.0, 0.0, 0.0])


if __name__ == "__main__":
    unittest.main()
