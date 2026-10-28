// Original eight-bar arrangements. Each entry is one eighth note; 0 is a rest.
const arrangements = [
  {
    bpm: 116,
    roots: [48, 45, 53, 55, 48, 45, 53, 55],
    minor: [1, 5],
    melody: [
      [72, 0, 76, 79, 81, 79, 76, 0],
      [72, 76, 81, 0, 79, 76, 74, 0],
      [77, 0, 81, 84, 83, 81, 79, 77],
      [79, 0, 77, 74, 71, 0, 74, 0],
      [76, 79, 84, 0, 83, 79, 76, 0],
      [81, 79, 76, 72, 74, 76, 79, 0],
      [77, 81, 84, 81, 79, 77, 76, 74],
      [71, 74, 79, 77, 76, 74, 72, 0],
    ],
  },
  {
    bpm: 104,
    roots: [45, 53, 48, 55, 45, 53, 50, 52],
    minor: [0, 4, 6],
    melody: [
      [69, 0, 72, 76, 0, 74, 72, 0],
      [69, 72, 77, 0, 76, 72, 69, 0],
      [67, 0, 72, 76, 79, 76, 72, 0],
      [71, 74, 79, 0, 77, 74, 71, 0],
      [76, 0, 81, 79, 76, 72, 74, 76],
      [77, 0, 81, 84, 81, 77, 76, 0],
      [74, 77, 81, 77, 76, 74, 72, 0],
      [71, 0, 76, 74, 72, 71, 69, 0],
    ],
  },
  {
    bpm: 124,
    roots: [53, 48, 50, 46, 53, 48, 46, 48],
    minor: [2],
    melody: [
      [77, 81, 84, 0, 81, 79, 77, 0],
      [76, 79, 84, 79, 76, 0, 74, 76],
      [77, 81, 86, 0, 84, 81, 79, 0],
      [77, 0, 74, 77, 82, 81, 77, 0],
      [81, 84, 89, 0, 88, 84, 81, 0],
      [79, 84, 88, 84, 81, 79, 76, 0],
      [77, 82, 86, 84, 82, 81, 79, 77],
      [76, 79, 84, 79, 77, 76, 77, 0],
    ],
  },
  {
    bpm: 112,
    roots: [50, 55, 47, 45, 50, 55, 52, 45],
    minor: [2, 6],
    melody: [
      [74, 0, 78, 81, 78, 0, 76, 74],
      [71, 74, 79, 0, 78, 74, 71, 0],
      [71, 74, 78, 81, 83, 81, 78, 0],
      [73, 0, 76, 81, 79, 76, 73, 0],
      [78, 81, 86, 0, 85, 81, 78, 0],
      [79, 0, 83, 86, 83, 79, 78, 76],
      [76, 79, 83, 79, 78, 76, 74, 0],
      [73, 76, 81, 79, 78, 76, 74, 0],
    ],
  },
  {
    bpm: 108,
    roots: [48, 44, 51, 46, 48, 44, 53, 55],
    minor: [0, 4, 6],
    melody: [
      [72, 0, 75, 79, 82, 79, 75, 0],
      [72, 75, 80, 0, 79, 75, 72, 0],
      [75, 0, 79, 82, 87, 82, 79, 0],
      [77, 82, 86, 82, 80, 77, 74, 0],
      [79, 82, 87, 0, 86, 82, 79, 0],
      [80, 0, 84, 87, 84, 80, 79, 77],
      [77, 80, 84, 80, 79, 77, 75, 0],
      [74, 0, 79, 77, 75, 74, 72, 0],
    ],
  },
  {
    bpm: 92,
    roots: [45, 50, 53, 52, 45, 48, 50, 52],
    minor: [0, 1, 4, 6],
    melody: [
      [76, 0, 81, 0, 79, 76, 72, 0],
      [74, 0, 77, 81, 0, 77, 74, 0],
      [77, 81, 84, 0, 81, 0, 79, 77],
      [76, 0, 71, 74, 76, 0, 0, 0],
      [81, 0, 84, 88, 0, 84, 81, 79],
      [79, 0, 76, 72, 76, 79, 0, 0],
      [77, 0, 81, 86, 84, 81, 77, 0],
      [76, 0, 74, 71, 72, 0, 69, 0],
    ],
  },
] as const;
export const mapMelodies = arrangements.map((a) => a.melody.flat());
export type MusicNote = {
  midi: number;
  endMidi?: number;
  beats: number;
  type: OscillatorType;
  gain: number;
};
export function musicStep(stage: number, index: number) {
  const track = arrangements[Math.max(0, Math.min(5, Math.floor(stage) - 1))];
  const step = ((index % 64) + 64) % 64,
    bar = Math.floor(step / 8),
    beat = step % 8;
  const root = track.roots[bar],
    third = (track.minor as readonly number[]).includes(bar) ? 3 : 4;
  const chord = [root, root + third, root + 7];
  const lead = track.melody[bar][beat];
  const notes: MusicNote[] = [];
  if (lead)
    notes.push({
      midi: lead,
      beats: track.melody[bar][beat + 1] === 0 ? 1.55 : 0.78,
      type: "triangle",
      gain: 0.105,
    });
  if (beat % 2 === 0)
    notes.push({
      midi: root - 12 + (beat === 6 ? 7 : 0),
      beats: 1.55,
      type: "triangle",
      gain: 0.09,
    });
  if (beat === 0 || beat === 4)
    for (const midi of chord)
      notes.push({ midi: midi + 12, beats: 2.7, type: "sine", gain: 0.018 });
  if (beat % 2 === 1)
    notes.push({ midi: chord[(beat >> 1) % 3] + 24, beats: 0.42, type: "square", gain: 0.012 });
  // Tonal percussion keeps the small synth self-contained, with no sample downloads.
  if (beat === 0 || beat === 4)
    notes.push({ midi: 43, endMidi: 28, beats: 0.46, type: "sine", gain: 0.075 });
  if (beat === 2 || beat === 6)
    notes.push({ midi: 66, endMidi: 45, beats: 0.24, type: "triangle", gain: 0.035 });
  if (stage !== 6 || beat % 2 === 0)
    notes.push({ midi: 109, endMidi: 100, beats: 0.1, type: "triangle", gain: 0.008 });
  return { seconds: 30 / track.bpm, notes };
}
