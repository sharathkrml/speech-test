const clean = (text: string): string[] =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

const distance = (a: string, b: string): number => {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
};

const similar = (a: string, b: string): number => 1 - distance(a, b) / Math.max(a.length, b.length, 1);

export type WordMatch = {
  matched: boolean[];
  score: number;
};

/** Which twister words were heard, in order, and the share that matched. */
export function matchWords(twister: string, heard: string): WordMatch {
  const target = clean(twister);
  const spoken = clean(heard);
  const rows = target.length;
  const columns = spoken.length;
  const table = Array.from({ length: rows + 1 }, () => new Int32Array(columns + 1));

  for (let i = 1; i <= rows; i++) {
    for (let j = 1; j <= columns; j++) {
      table[i][j] = Math.max(table[i - 1][j], table[i][j - 1]);
      if (similar(target[i - 1], spoken[j - 1]) >= 0.7) {
        table[i][j] = Math.max(table[i][j], table[i - 1][j - 1] + 1);
      }
    }
  }

  const matched = new Array<boolean>(rows).fill(false);
  let i = rows;
  let j = columns;
  while (i > 0 && j > 0) {
    if (table[i][j] === table[i - 1][j]) {
      i--;
    } else if (table[i][j] === table[i][j - 1]) {
      j--;
    } else {
      matched[i - 1] = true;
      i--;
      j--;
    }
  }

  return { matched, score: rows ? matched.filter(Boolean).length / rows : 0 };
}

export const wordScore = (twister: string, heard: string): number => matchWords(twister, heard).score;
