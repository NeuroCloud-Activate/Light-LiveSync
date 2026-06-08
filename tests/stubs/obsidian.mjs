if (typeof globalThis.window === "undefined") {
  globalThis.window = globalThis;
}
if (typeof globalThis.self === "undefined") {
  globalThis.self = globalThis;
}

export async function requestUrl() {
  if (process.env.OBSIDIAN_STUB_REQUEST_URL_MODE === "address-unreachable") {
    throw new Error("net::ERR_ADDRESS_UNREACHABLE");
  }
  if (process.env.OBSIDIAN_STUB_REQUEST_URL_MODE === "hang") {
    return new Promise(() => {});
  }

  const input = arguments[0];
  const url = typeof input === "string" ? input : input.url;
  const method = typeof input === "string" ? "GET" : input.method ?? "GET";
  const headers = typeof input === "string" ? {} : input.headers ?? {};
  const contentType = typeof input === "string" ? undefined : input.contentType;
  const body = typeof input === "string" ? undefined : input.body;
  const response = await fetch(url, {
    method,
    headers: {
      ...headers,
      ...(contentType ? { "Content-Type": contentType } : {})
    },
    body
  });
  const arrayBuffer = await response.arrayBuffer();
  const text = new TextDecoder().decode(arrayBuffer);
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    arrayBuffer,
    text,
    json: text ? JSON.parse(text) : undefined
  };
}

export const Platform = {
  isMobile: process.env.OBSIDIAN_STUB_IS_MOBILE === "true",
  isDesktopApp: process.env.OBSIDIAN_STUB_IS_MOBILE !== "true"
};

export const activeWindow = globalThis.window ?? globalThis;

export const activeDocument = globalThis.document ?? {
  hidden: false,
  addEventListener() {},
  removeEventListener() {}
};

export class PluginSettingTab {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = createContainer();
  }
}

export class Setting {
  constructor(containerEl) {
    this.containerEl = containerEl;
    this.settingEl = containerEl.createEl("div");
  }

  setName(name) {
    this.settingEl.createEl("span", { text: name });
    this.containerEl.textContent += ` ${name}`;
    return this;
  }

  setDesc(description) {
    this.settingEl.createEl("p", { text: description });
    this.containerEl.textContent += ` ${description}`;
    return this;
  }

  setHeading() {
    this.settingEl.heading = true;
    return this;
  }

  addButton(callback) {
    const button = createButton();
    callback(button);
    this.settingEl.children.push(button);
    this.settingEl.textContent += ` ${button.text}`;
    this.containerEl.textContent += ` ${button.text}`;
    return this;
  }

  addToggle(callback) {
    const toggle = createToggle();
    callback(toggle);
    this.settingEl.children.push(toggle);
    return this;
  }

  addText(callback) {
    const text = createTextComponent("input");
    callback(text);
    this.settingEl.children.push(text);
    return this;
  }

  addSearch(callback) {
    const text = createTextComponent("input");
    callback(text);
    this.settingEl.children.push(text);
    return this;
  }

  addTextArea(callback) {
    const text = createTextComponent("textarea");
    callback(text);
    this.settingEl.children.push(text);
    return this;
  }
}

function createContainer(tag = "div", parent = undefined) {
  return {
    tag,
    parent,
    textContent: "",
    children: [],
    classes: [],
    attrs: {},
    onclick: undefined,
    empty() {
      this.textContent = "";
      this.children = [];
    },
    addClass(name) {
      this.classes.push(name);
    },
    removeClass(name) {
      this.classes = this.classes.filter((current) => current !== name);
    },
    setAttr(name, value) {
      this.attrs[name] = value;
    },
    appendText(value) {
      this.textContent += ` ${value}`;
      this.parent?.appendText(value);
    },
    createEl(childTag, options = {}) {
      const child = createContainer(childTag, this);
      if (typeof options.text === "string") {
        child.appendText(options.text);
      }
      this.children.push(child);
      return child;
    }
  };
}

function createButton() {
  return {
    text: "",
    callback: undefined,
    cta: false,
    setButtonText(value) {
      this.text = value;
      return this;
    },
    setCta() {
      this.cta = true;
      return this;
    },
    onClick(callback) {
      this.callback = callback;
      return this;
    }
  };
}

function createToggle() {
  return {
    value: false,
    disabled: false,
    callback: undefined,
    setValue(value) {
      this.value = value;
      return this;
    },
    setDisabled(value) {
      this.disabled = value;
      return this;
    },
    onChange(callback) {
      this.callback = callback;
      return this;
    }
  };
}

function createTextComponent(tag) {
  return {
    inputEl: {
      tag,
      rows: 0,
      type: "text",
      value: "",
      placeholder: "",
      attrs: {},
      setAttribute(name, value) {
        this.attrs[name] = value;
      }
    },
    callback: undefined,
    setPlaceholder(value) {
      this.inputEl.placeholder = value;
      return this;
    },
    setValue(value) {
      this.inputEl.value = value;
      return this;
    },
    onChange(callback) {
      this.callback = callback;
      return this;
    }
  };
}
