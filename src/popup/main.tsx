import { render } from "preact";
import { App } from "./App";

const root = document.getElementById("app");
if (!root) throw new Error("Không tìm thấy root element.");
render(<App />, root);
