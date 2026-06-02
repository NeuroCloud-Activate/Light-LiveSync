type LineMatch = {
  currentIndex: number;
  incomingIndex: number;
};

function splitLines(value: string): string[] {
  return value.replace(/\r\n/g, "\n").split("\n");
}

function hasTrailingNewline(value: string): boolean {
  return value.endsWith("\n") || value.endsWith("\r\n");
}

function isSubsequence<T>(candidate: T[], source: T[]): boolean {
  let candidateIndex = 0;
  for (const item of source) {
    if (item === candidate[candidateIndex]) {
      candidateIndex += 1;
      if (candidateIndex === candidate.length) {
        return true;
      }
    }
  }
  return candidateIndex === candidate.length;
}

function isCharacterSubsequence(candidate: string, source: string): boolean {
  let candidateIndex = 0;
  for (let sourceIndex = 0; sourceIndex < source.length; sourceIndex += 1) {
    if (source[sourceIndex] === candidate[candidateIndex]) {
      candidateIndex += 1;
      if (candidateIndex === candidate.length) {
        return true;
      }
    }
  }
  return candidateIndex === candidate.length;
}

function longestCommonSubsequence(current: string[], incoming: string[]): LineMatch[] {
  const lengths = Array.from({ length: current.length + 1 }, () => Array<number>(incoming.length + 1).fill(0));
  for (let currentIndex = current.length - 1; currentIndex >= 0; currentIndex -= 1) {
    for (let incomingIndex = incoming.length - 1; incomingIndex >= 0; incomingIndex -= 1) {
      lengths[currentIndex][incomingIndex] = current[currentIndex] === incoming[incomingIndex]
        ? lengths[currentIndex + 1][incomingIndex + 1] + 1
        : Math.max(lengths[currentIndex + 1][incomingIndex], lengths[currentIndex][incomingIndex + 1]);
    }
  }

  const matches: LineMatch[] = [];
  let currentIndex = 0;
  let incomingIndex = 0;
  while (currentIndex < current.length && incomingIndex < incoming.length) {
    if (current[currentIndex] === incoming[incomingIndex]) {
      matches.push({ currentIndex, incomingIndex });
      currentIndex += 1;
      incomingIndex += 1;
    } else if (lengths[currentIndex + 1][incomingIndex] >= lengths[currentIndex][incomingIndex + 1]) {
      currentIndex += 1;
    } else {
      incomingIndex += 1;
    }
  }
  return matches;
}

function appendCurrentBlock(result: string[], current: string[], start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    result.push(current[index]);
  }
}

function appendIncomingOnlyBlock(
  result: string[],
  incoming: string[],
  currentLineSet: Set<string>,
  start: number,
  end: number
): void {
  for (let index = start; index < end; index += 1) {
    const line = incoming[index];
    if (line && !currentLineSet.has(line)) {
      result.push(line);
      currentLineSet.add(line);
    }
  }
}

export function automaticTextMerge(current: string, incoming: string): string {
  if (current === incoming) {
    return current;
  }
  if (incoming.includes(current)) {
    return incoming;
  }

  const currentLines = splitLines(current);
  const incomingLines = splitLines(incoming);
  if (
    incoming.length < current.length &&
    (isSubsequence(incomingLines, currentLines) || isCharacterSubsequence(incoming, current))
  ) {
    return incoming;
  }

  const currentLineSet = new Set(currentLines);
  const matches = longestCommonSubsequence(currentLines, incomingLines);
  const result: string[] = [];
  let currentCursor = 0;
  let incomingCursor = 0;

  for (const match of matches) {
    appendCurrentBlock(result, currentLines, currentCursor, match.currentIndex);
    appendIncomingOnlyBlock(result, incomingLines, currentLineSet, incomingCursor, match.incomingIndex);
    result.push(currentLines[match.currentIndex]);
    currentCursor = match.currentIndex + 1;
    incomingCursor = match.incomingIndex + 1;
  }

  appendCurrentBlock(result, currentLines, currentCursor, currentLines.length);
  appendIncomingOnlyBlock(result, incomingLines, currentLineSet, incomingCursor, incomingLines.length);

  const merged = result.join("\n");
  if (merged === current) {
    return current;
  }
  return hasTrailingNewline(current) || hasTrailingNewline(incoming) ? `${merged.replace(/\n*$/, "")}\n` : merged;
}
