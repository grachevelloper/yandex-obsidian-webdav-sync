export function clock() {
  let time = Date.UTC(2026, 9, 29);
  const delays: number[] = [];

  return {
    now: () => time,
    sleep: async (milliseconds: number) => {
      delays.push(milliseconds);
      time += milliseconds;
    },
    delays,
  };
}
