import unittest

from double import double


class TestDouble(unittest.TestCase):
    def test_two(self):
        self.assertEqual(double(2), 4)

    def test_zero(self):
        self.assertEqual(double(0), 0)

    def test_negative(self):
        self.assertEqual(double(-3), -6)


if __name__ == "__main__":
    unittest.main()
