import { App, Modal, Setting } from "obsidian";
import type { CredentialPayload } from "./settings";

export type ServerCredentialsModalResult = {
  credentials: CredentialPayload;
};

export class ServerCredentialsModal extends Modal {
  private couchDbPassword = "";
  private passphrase = "";
  private resolve: (value: ServerCredentialsModalResult | false) => void = () => {};

  constructor(app: App) {
    super(app);
  }

  openAndWait(): Promise<ServerCredentialsModalResult | false> {
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
    contentEl.createEl("h2", { text: "Update credentials" });
    contentEl.createEl("p", {
      text: "Update the private values used for CouchDB and encrypted vault sync. These are saved encrypted in plugin data and stay available on this device after setup."
    });

    new Setting(contentEl)
      .setName("CouchDB password")
      .setDesc("Password for the CouchDB username shown in settings. The plugin uses it to read and write the vault database.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.setAttribute("autocapitalize", "off");
        text.inputEl.setAttribute("autocomplete", "new-password");
        text.inputEl.setAttribute("spellcheck", "false");
        text.onChange((value) => {
          this.couchDbPassword = value;
        });
      });

    new Setting(contentEl)
      .setName("Vault E2EE passphrase")
      .setDesc("Shared encryption passphrase for this vault. Use the same value on every device so synced files can be decrypted.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.setAttribute("autocapitalize", "off");
        text.inputEl.setAttribute("autocomplete", "new-password");
        text.inputEl.setAttribute("spellcheck", "false");
        text.onChange((value) => {
          this.passphrase = value;
        });
      });

    new Setting(contentEl)
      .addButton((button) => {
        button
          .setButtonText("Save encrypted")
          .setCta()
          .onClick(() => {
            this.closeWith({
              credentials: {
                couchDbPassword: this.couchDbPassword,
                passphrase: this.passphrase
              }
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

  private closeWith(result: ServerCredentialsModalResult | false): void {
    this.resolve(result);
    this.close();
  }
}
