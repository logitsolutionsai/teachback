# Bloom Filters In Five Minutes

An original explainer written for the teachback example course. Sections are numbered so the course can cite them.

## 1. The Membership Question

Many programs need to answer one question fast: "have I seen this before?" A web crawler asks it about URLs, a database asks it before reading a block from disk, and a spell checker asks it about words. The exact answer needs a set that stores every item, and that set grows with the size of the items themselves. A Bloom filter gives up a little exactness to answer in a fixed, small amount of memory: a few bits per item, no matter how long each item is.

## 2. Hash Functions As Scatter

A hash function turns any input into a number. For a Bloom filter we want three properties: the same input always gives the same number, different inputs spread evenly over the range, and the outputs of different hash functions behave as if they were independent. We rarely need truly separate functions. A common trick computes two base hashes, h1 and h2, and derives the i-th position as (h1 + i * h2) mod m. This is called double hashing, and in practice it works almost as well as k independent hash functions.

## 3. Insert And Query

A Bloom filter is an array of m bits, all starting at 0, and k hash functions that each pick a position in the array. To insert an item, compute its k positions and set those bits to 1. To ask whether an item is present, compute the same k positions and check them. If any of those bits is 0, the item was never inserted: the filter is certain. If all of them are 1, the item was probably inserted. So a Bloom filter can say "definitely not" or "probably yes". It never gives a false negative, because inserting an item sets every bit that a later query for it will check.

## 4. False Positives

"Probably yes" is wrong when the k bits were all set by other items. After inserting n items with k hash functions into m bits, the chance that one particular bit is still 0 is about e^(-kn/m). A query for an absent item fails only if all k of its bits are 1, so the false-positive rate is about p = (1 - e^(-kn/m))^k. The rate grows as the filter fills: more items, or fewer bits, means more ones in the array and more accidental matches.

## 5. Choosing The Number Of Hashes And Bits

More hash functions check more bits per query, which helps, but each insert also sets more bits, which hurts. For a given m and n, the rate is lowest when k = (m/n) ln 2, which leaves about half the bits set. At that k, the rate is about 0.6185^(m/n). Turning this around, to hold n items at a target rate p you need about m = -n ln p / (ln 2)^2 bits. For a 1% rate that is about 9.6 bits per item, whatever the items are.

## 6. Deletion

You cannot simply delete from a Bloom filter. Clearing an item's bits could also clear bits that other items rely on, and then those items would start returning "definitely not": a false negative, which the filter promised never to give. A counting Bloom filter replaces each bit with a small counter. Insert increments the k counters and delete decrements them, so deletion works, at the cost of several times more memory.
