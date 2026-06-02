import { App, Modal, Setting } from "obsidian";

export class UnlockCredentialsModal extends Modal {
  private passphrase = "";
  private resolve: (value: string | false) => void = () => {};

  constructor(
    app: App,
    private readonly title = "Unlock credentials",
    private readonly buttonText = "Unlock"
  ) {
    super(app);
  }

  openAndWait(): Promise<string | false> {
    this.open();
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.title });
    contentEl.createEl("p", {
      text: "Unlock the encrypted CouchDB password and vault E2EE passphrase for this Obsidian session."
    });

    new Setting(contentEl)
      .setName("Credential passphrase")
      .setDesc("This is the local passphrase used when the credentials were saved, not your CouchDB password.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.onChange((value) => {
          this.passphrase = value;
        });
      });

    new Setting(contentEl)
      .addButton((button) => {
        button
          .setButtonText(this.buttonText)
          .setCta()
          .onClick(() => this.closeWith(this.passphrase));
      })
      .addButton((button) => {
        button.setButtonText("Cancel").onClick(() => this.closeWith(false));
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private closeWith(result: string | false): void {
    this.resolve(result);
    this.close();
  }
}
