# Exponential Moving Averages: Study Notes

Original notes written for the teachback eval suite (MIT, like the rest of the repository).

## 1. The Update Rule

An exponential moving average (EMA) keeps one number, s, and updates it every time a new reading x arrives:

    s_new = α · x + (1 − α) · s_old

The smoothing factor α lies between 0 and 1. A large α trusts the newest reading; a small α trusts the history. Each update needs only the previous average and the new reading, so an EMA uses constant memory no matter how long the stream runs. Think of it as a running summary that forgets gracefully.

## 2. Where The Weights Go

Unrolling the update shows what the average is made of. The newest reading gets weight α, the one before it α(1 − α), the one before that α(1 − α)², and so on. Every older reading is discounted by the factor (1 − α) once more, so the past fades by the same factor at every step. The weights form a geometric series, and with an infinite history they sum to exactly 1.

A useful rule of thumb follows: the average mostly reflects about the last 1/α readings. With α = 0.1 that is roughly the last 10 readings; with α = 0.01, roughly the last 100.

## 3. Half-Life

The half-life is the number of steps after which a reading's weight has dropped to half. Solving (1 − α)^h = 1/2 gives h = ln 2 / (−ln(1 − α)). For small α this is close to 0.69 / α. With α = 0.1 the exact half-life is about 6.6 steps: a reading from seven steps ago counts for less than half as much as the newest one.

## 4. The Cold-Start Bias

If the average starts at s = 0, the first few values are pulled toward zero, because the weights on the readings seen so far add up to only 1 − (1 − α)^t after t updates, not to 1. With α = 0.1, after one reading the average is only a tenth of that reading.

The fix is to divide by the missing mass: report s / (1 − (1 − α)^t). After the first reading this correction returns the reading itself, and as t grows the divisor approaches 1 and the correction fades away. The Adam optimiser applies exactly this correction to its running averages of gradients.

## 5. Compared With A Simple Moving Average

A simple moving average (SMA) of the last N readings weights each of them equally and ignores everything older. It must store all N readings, while an EMA stores one number. When the signal jumps to a new level, an SMA reaches the new level after exactly N steps; an EMA approaches it smoothly and never quite arrives, closing a fraction α of the remaining gap at each step.

An EMA is commonly matched to an N-reading SMA with α = 2 / (N + 1), which gives both averages the same mean age of the readings they contain. For N = 19 that is α = 0.1.

## 6. Choosing α

A smaller α gives a smoother average that reacts slowly; a larger α tracks changes quickly but passes more noise through. There is no single right value: pick α from how far back the average should remember, using 1/α or the half-life as the guide.
