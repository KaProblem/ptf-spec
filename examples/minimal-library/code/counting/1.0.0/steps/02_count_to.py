"""Step 2: count to any number, in any step size.

    python steps/02_count_to.py --to 20 --by 2
"""

import argparse

parser = argparse.ArgumentParser(description="Count to a number.")
parser.add_argument("--to", type=int, default=10, help="where to stop")
parser.add_argument("--by", type=int, default=1, help="how much to add each time")
args = parser.parse_args()

n = 0
while n + args.by <= args.to:
    n = n + args.by
    print(n)
print(f"counted to {n} in steps of {args.by}")
