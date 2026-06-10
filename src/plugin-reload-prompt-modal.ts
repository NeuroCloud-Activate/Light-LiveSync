import { Modal, Setting, type App } from "obsidian";

export type PluginReloadPromptDetails = {
  changedSettingsCount: number;
};

export class PluginReloadPromptModal extends Modal {
  private resolve: (result: boolean) => void = () => {};

  constructor(app: App, private readonly details: PluginReloadPromptDetails) {
    super(app);
  }

  openAndWait(): Promise<boolean> {
    this.open();
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("light-livesync-modal");
    contentEl.createEl("h2", { text: "Reload needed" });
    contentEl.createEl("p", {
      text: "Synced plugin settings or data changed. Some plugins only read those settings when the app starts, so Light-LiveSync will wait for your choice before reloading."
    });

    contentEl.createEl("p", {
      text: `${this.details.changedSettingsCount} plugin settings/data file${this.details.changedSettingsCount === 1 ? "" : "s"} updated.`
    });

    new Setting(contentEl)
      .addButton((button) => {
        button
          .setButtonText("Reload now")
          .setCta()
          .onClick(() => this.closeWith(true));
      })
      .addButton((button) => {
        button
          .setButtonText("Later")
          .onClick(() => this.closeWith(false));
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private closeWith(result: boolean): void {
    this.resolve(result);
    this.close();
  }
}
