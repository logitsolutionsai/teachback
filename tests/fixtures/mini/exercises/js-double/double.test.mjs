import { test } from 'node:test';
import assert from 'node:assert/strict';
import { double } from './double.mjs';

test('doubles two', () => assert.equal(double(2), 4));
test('doubles zero', () => assert.equal(double(0), 0));
test('doubles a negative', () => assert.equal(double(-3), -6));
