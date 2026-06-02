import { App, Modal, Setting } from "obsidian";

export type SetupUriModalResult = {
  setupUri: string;
  passphrase: string;
};

export class SetupUriModal extends Modal {
  private setupUri = "";
  private passphrase = "";
  private resolve: (value: SetupUriModalResult | false) => void = () => {};

  constructor(app: App, initialSetupUri = "") {
    super(app);
    this.setupUri = initialSetupUri;
  }

  openAndWait(): Promise<SetupUriModalResult | false> {
    this.open();
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass("light-livesync-modal-shell");
    contentEl.empty();
    contentEl.addClass("light-livesync-modal");
    contentEl.addClass("light-livesync-setup-uri-modal");
    contentEl.createEl("h2", { text: "Use setup URI" });
    contentEl.createEl("p", {
      text: "Import an existing Self-hosted LiveSync setup link. The plugin keeps the same URI workflow, then stores secrets encrypted locally."
    });

    new Setting(contentEl)
      .setName("Setup URI")
      .setDesc("Paste the obsidian://setuplivesync link. If you copied the full terminal output from the CouchDB helper, the plugin will find the setup link inside it.")
      .addTextArea((text) => {
        text.inputEl.rows = 6;
        text.inputEl.setAttribute("autocapitalize", "off");
        text.inputEl.setAttribute("autocomplete", "off");
        text.inputEl.setAttribute("spellcheck", "false");
        text.setPlaceholder("obsidian://setuplivesync?settings=...");
        text.setValue(this.setupUri);
        text.onChange((value) => {
          this.setupUri = value;
        });
      });

    new Setting(contentEl)
      .setName("Setup URI passphrase")
      .setDesc("Passphrase used to decrypt the setup URI payload. It is also used to protect imported credentials on this device.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.setAttribute("autocapitalize", "off");
        text.inputEl.setAttribute("autocomplete", "off");
        text.inputEl.setAttribute("spellcheck", "false");
        text.onChange((value) => {
          this.passphrase = value;
        });
      });

    new Setting(contentEl)
      .addButton((button) => {
        button
          .setButtonText("Import")
          .setCta()
          .onClick(() => {
            this.closeWith({
              setupUri: this.setupUri,
              passphrase: this.passphrase
            });
          });
      })
      .addButton((button) => {
        button.setButtonText("Cancel").onClick(() => this.closeWith(false));
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private closeWith(result: SetupUriModalResult | false): void {
    this.resolve(result);
    this.close();
  }
}
