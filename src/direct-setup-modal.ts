import { App, Modal, Setting } from "obsidian";
import {
  DIRECT_SETUP_FIELD_DESCRIPTIONS,
  directCouchDbSetupInputFromValueSources,
  normaliseDirectCouchDbSetupInput,
  type DirectCouchDbSetupInput,
  type DirectCouchDbSetupValueSources
} from "./direct-setup";

export class DirectCouchDbSetupModal extends Modal {
  private input: DirectCouchDbSetupInput = {
    hostname: "",
    database: "",
    passphrase: "",
    username: "",
    password: ""
  };
  private inputElements: DirectCouchDbSetupValueSources = {};
  private resolve: (value: DirectCouchDbSetupInput | false) => void = () => {};

  constructor(app: App) {
    super(app);
  }

  openAndWait(): Promise<DirectCouchDbSetupInput | false> {
    this.open();
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Connect CouchDB" });
    contentEl.createEl("p", {
      text: "Enter the same values used by the setup URI generator. The plugin will verify the credentials by opening or creating the database, restrict database access to this CouchDB user, initialise LiveSync sync parameters, and require E2EE before syncing."
    });

    this.addTextField("hostname", "192.0.2.10:5984");
    this.addTextField("database", "my_vault");
    this.addTextField("passphrase", "Vault E2EE passphrase", true);
    this.addTextField("username", "CouchDB user");
    this.addTextField("password", "CouchDB password", true);

    new Setting(contentEl)
      .addButton((button) => {
        button
          .setButtonText("Connect")
          .setCta()
          .onClick(() => {
            this.closeWith(normaliseDirectCouchDbSetupInput(this.currentInput()));
          });
      })
      .addButton((button) => {
        button.setButtonText("Cancel").onClick(() => this.closeWith(false));
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private addTextField(field: keyof DirectCouchDbSetupInput, placeholder: string, password = false): void {
    const description = DIRECT_SETUP_FIELD_DESCRIPTIONS[field];
    new Setting(this.contentEl)
      .setName(description.label)
      .setDesc(description.description)
      .addText((text) => {
        if (password) {
          text.inputEl.type = "password";
        }
        this.inputElements[field] = text.inputEl;
        text.setPlaceholder(placeholder);
        text.onChange((value) => {
          this.input = {
            ...this.input,
            [field]: value
          };
        });
      });
  }

  private currentInput(): DirectCouchDbSetupInput {
    return directCouchDbSetupInputFromValueSources(this.input, this.inputElements);
  }

  private closeWith(result: DirectCouchDbSetupInput | false): void {
    this.resolve(result);
    this.close();
  }
}
