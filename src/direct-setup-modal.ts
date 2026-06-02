import { App, Modal, Notice, Setting } from "obsidian";
import {
  DIRECT_SETUP_FIELD_DESCRIPTIONS,
  buildCouchDbSetupCommand,
  directCouchDbSetupInputFromValueSources,
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

  constructor(app: App, initial: Partial<DirectCouchDbSetupInput> = {}) {
    super(app);
    this.input = {
      ...this.input,
      ...initial,
      passphrase: "",
      password: ""
    };
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
    contentEl.addClass("light-livesync-modal");
    contentEl.createEl("h2", { text: "Connect CouchDB" });
    contentEl.createEl("p", {
      text: "Enter the sync values that should go into the setup URI. The plugin uses these fields to copy a server-side setup command; it does not connect from this window."
    });
    contentEl.createEl("p", {
      text: "Run the copied command directly on the self-hosted server side where CouchDB is reachable, such as the server terminal or the Docker container console for your CouchDB setup. If you are creating a new sync user or database, fill in the optional CouchDB admin variables in that command before running it."
    });

    this.addTextField("hostname", "192.0.2.10:5984");
    this.addTextField("database", "my_vault");
    this.addTextField("passphrase", "Vault E2EE passphrase", true);
    this.addTextField("username", "CouchDB user");
    this.addTextField("password", "CouchDB password", true);

    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText("Copy setup command").setCta().onClick(() => {
          void this.copySetupCommand();
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
        text.setValue(this.input[field]);
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

  private async copySetupCommand(): Promise<void> {
    const command = buildCouchDbSetupCommand(this.currentInput());
    await navigator.clipboard.writeText(command);
    new Notice("CouchDB setup command copied.");
  }
}
