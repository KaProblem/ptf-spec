// Recomputes the answers of elements/counting.md (SPEC.md §7.1).

// After 3 comes 3 + 1.
check("q1", () => String(3 + 1));

// One option per value; the check marks which ones are correct.
check("q2", (q) => q.options.map((o) => ptf.num(o.text) === 6 + 1));

// Count every number from 17 to 42 by listing them.
check("q3", () => {
  let n = 0;
  for (let k = 17; k <= 42; k++) n++;
  return n;
});
