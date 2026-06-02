import { App, Modal, Notice, Setting } from "obsidian";

export class GeneratedSetupUriModal extends Modal {
  constructor(
    app: App,
    private readonly setupUri: string
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Add another device" });
    contentEl.createEl("p", {
      text: "Copy this encrypted setup URI to the new device. On the new device, choose Use setup URI and enter the same shared E2EE passphrase when asked."
    });
    contentEl.createEl("p", {
      text: "This does not create a database. It connects the new device to the database already initialized by this device."
    });

    new Setting(contentEl)
      .setName("Encrypted setup URI")
      .setDesc("Treat this like a temporary invite code. It is encrypted, but anyone with the URI and passphrase can connect to the same sync database.")
      .addTextArea((text) => {
        text.inputEl.rows = 8;
        text.setValue(this.setupUri);
      });

    new Setting(contentEl)
      .addButton((button) => {
        button
          .setButtonText("Copy URI")
          .setCta()
          .onClick(async () => {
            try {
              await navigator.clipboard.writeText(this.setupUri);
              new Notice("Setup URI copied.");
            } catch {
              new Notice("Copy was not available. Select the URI text and copy it manually.");
            }
          });
      })
      .addButton((button) => {
        button.setButtonText("Done").onClick(() => this.close());
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
