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
    contentEl.addClass("light-livesync-command-modal");
    contentEl.createEl("h2", { text: "Prepare CouchDB Setup Command" });
    contentEl.createEl("p", {
      text: "Enter the Server Domain, Database Name, Database User, and Database Password configured in your server-side CouchDB instance. These values are used to generate the setup URI that this plugin imports."
    });
    contentEl.createEl("p", {
      text: "Run the copied command directly on the CouchDB host, such as the server terminal, SSH session, or Docker container console. If creating a new database user or database, fill in the optional CouchDB admin variables in that command before running it."
    });

    this.addTextField("hostname", "https://sync.example.com:5984");
    this.addTextField("database", "my_vault");
    this.addTextField("passphrase", "Vault E2EE passphrase", true);
    this.addTextField("username", "Database user");
    this.addTextField("password", "Database password", true);

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
