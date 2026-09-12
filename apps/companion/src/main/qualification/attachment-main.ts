import type { UserFilePicker } from "../codex/task-attachments.js";

const picker: UserFilePicker = {
  async select() {
    return [
      {
        filename: "semantic-upload.txt",
        mimeType: "text/plain",
        bytes: Buffer.alloc(74, "R"),
      },
    ];
  },
};

(
  globalThis as typeof globalThis & {
    __roveQualificationAttachmentPicker?: UserFilePicker;
  }
).__roveQualificationAttachmentPicker = picker;

await import("../main.js");
