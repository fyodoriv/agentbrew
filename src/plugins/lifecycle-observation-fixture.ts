import { lifecycleObservation, writeObservation } from "./lifecycle-observation.js";

const observe = lifecycleObservation("synthetic", writeObservation);
void observe("add", () => new Promise(() => {}));
setInterval(() => {}, 1000);
