"""Step 1: count from 1 to 10.

Counting means adding one, again and again. Run it, then change the last
number and run it again.
"""

n = 0
for _ in range(10):
    n = n + 1  # each number is one more than the one before
    print(n)
print(f"counted to {n}")
