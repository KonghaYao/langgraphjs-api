import _mitt from "mitt";
const mitt = _mitt as unknown as typeof _mitt.default;
export const eventBus = mitt<{
  "run:put": { run_id: string; attempt: number };
}>();
