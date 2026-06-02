import { App, Modal, Setting } from "obsidian";

export type SetupUriModalResult = {
  setupUri: string;
  passphrase: string;
};

export class SetupUriModal extends Modal {
  private setupUri = "";
  private passphrase = "";
  private showSetupUriEditor = true;
  private stopViewportTracking: (() => void) | undefined;
  private resolve: (value: SetupUriModalResult | false) => void = () => {};

  constructor(app: App, initialSetupUri = "") {
    super(app);
    this.setupUri = initialSetupUri;
    this.showSetupUriEditor = !initialSetupUri;
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
    this.installViewportTracking();
    contentEl.createEl("h2", { text: "Use setup URI" });
    contentEl.createEl("p", {
      text: "Import a setup link and enter the shared E2EE passphrase for this vault."
    });

    new Setting(contentEl)
      .setName("Setup URI passphrase")
      .setDesc("Shared passphrase for the setup URI and encrypted vault sync.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.setAttribute("autocapitalize", "off");
        text.inputEl.setAttribute("autocomplete", "off");
        text.inputEl.setAttribute("spellcheck", "false");
        text.inputEl.addEventListener("focus", () => this.scrollFieldIntoView(text.inputEl));
        text.onChange((value) => {
          this.passphrase = value;
        });
      });

    if (!this.showSetupUriEditor && this.setupUri) {
      new Setting(contentEl)
        .setName("Setup URI")
        .setDesc("Setup URI loaded. Edit it only if you need to paste a different code.")
        .addButton((button) => {
          button.setButtonText("Edit URI").onClick(() => {
            this.showSetupUriEditor = true;
            this.onOpen();
          });
        });
    } else {
      this.renderSetupUriEditor(contentEl);
    }

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
    this.stopViewportTracking?.();
    this.stopViewportTracking = undefined;
    this.contentEl.empty();
  }

  private renderSetupUriEditor(contentEl: HTMLElement): void {
    new Setting(contentEl)
      .setName("Setup URI")
      .setDesc("Paste the obsidian://setuplivesync link, or paste the terminal output that contains it.")
      .addTextArea((text) => {
        text.inputEl.rows = 3;
        text.inputEl.setAttribute("autocapitalize", "off");
        text.inputEl.setAttribute("autocomplete", "off");
        text.inputEl.setAttribute("spellcheck", "false");
        text.inputEl.addEventListener("focus", () => this.scrollFieldIntoView(text.inputEl));
        text.setPlaceholder("obsidian://setuplivesync?settings=...");
        text.setValue(this.setupUri);
        text.onChange((value) => {
          this.setupUri = value;
        });
      });
  }

  private installViewportTracking(): void {
    this.stopViewportTracking?.();
    const viewport = window.visualViewport;
    const update = () => {
      const visibleHeight = viewport?.height ?? window.innerHeight;
      const offsetTop = viewport?.offsetTop ?? 0;
      const keyboardInset = Math.max(0, window.innerHeight - visibleHeight - offsetTop);
      const modalHeight = Math.max(260, visibleHeight - 16);
      const contentHeight = Math.max(220, visibleHeight - 32);
      this.modalEl.style.maxHeight = `${modalHeight}px`;
      this.contentEl.style.maxHeight = `${contentHeight}px`;
      this.contentEl.style.paddingBottom = `${Math.max(96, keyboardInset + 96)}px`;
    };
    update();
    window.addEventListener("resize", update);
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    this.stopViewportTracking = () => {
      window.removeEventListener("resize", update);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
    };
  }

  private scrollFieldIntoView(inputEl: HTMLElement): void {
    const scroll = () => {
      inputEl.scrollIntoView({ block: "center", inline: "nearest" });
    };
    scroll();
    window.setTimeout(scroll, 250);
    window.setTimeout(scroll, 650);
  }

  private closeWith(result: SetupUriModalResult | false): void {
    this.resolve(result);
    this.close();
  }
}
