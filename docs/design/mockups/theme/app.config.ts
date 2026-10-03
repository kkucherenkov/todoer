// Proposal for Nuxt UI 4.11.3. No product behavior or dependency changes.
export default defineAppConfig({
  ui: {
    colors: {
      primary: "indigo",
      secondary: "zinc",
      success: "green",
      info: "sky",
      warning: "amber",
      error: "red",
      neutral: "zinc",
    },
    button: {
      slots: {
        base: "focus-visible:outline-primary focus-visible:outline-solid focus-visible:outline-3",
      },
    },
    input: {
      slots: {
        base: "focus-visible:outline-primary focus-visible:outline-solid focus-visible:outline-3",
      },
    },
    select: {
      slots: {
        base: "focus-visible:outline-primary focus-visible:outline-solid focus-visible:outline-3",
      },
    },
    selectMenu: {
      slots: {
        base: "focus-visible:outline-primary focus-visible:outline-solid focus-visible:outline-3",
      },
    },
    textarea: {
      slots: {
        base: "focus-visible:outline-primary focus-visible:outline-solid focus-visible:outline-3",
      },
    },
    checkbox: {
      slots: {
        base: "focus-visible:outline-primary focus-visible:outline-solid focus-visible:outline-3",
      },
    },
    radioGroup: {
      slots: {
        base: "focus-visible:outline-primary focus-visible:outline-solid focus-visible:outline-3",
      },
    },
    switch: {
      slots: {
        base: "focus-visible:outline-primary focus-visible:outline-solid focus-visible:outline-3",
      },
    },
  },
});
