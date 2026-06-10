import { Modal, Setting, type App } from "obsidian";

export type PluginReloadPromptDetails = {
  changedPluginCount: number;
  communityPluginListChanged: boolean;
  ownPluginChanged: boolean;
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
      text: "Synced plugin changes are ready. Reloading applies the updated plugin list or plugin bundle, but Light-LiveSync will wait for your choice."
    });

    const details = [];
    if (this.details.communityPluginListChanged) {
      details.push("community plugin list");
    }
    if (this.details.changedPluginCount > 0) {
      details.push(`${this.details.changedPluginCount} plugin bundle${this.details.changedPluginCount === 1 ? "" : "s"}`);
    }
    if (this.details.ownPluginChanged) {
      details.push("Light-LiveSync bundle");
    }
    if (details.length > 0) {
      contentEl.createEl("p", { text: `Ready to apply: ${details.join(", ")}.` });
    }

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
