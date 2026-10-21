export default defineAppConfig({
  ui: {
    colors: {
      primary: 'indigo',
      secondary: 'zinc',
      success: 'green',
      info: 'sky',
      warning: 'amber',
      error: 'red',
      neutral: 'zinc',
    },
    button: {
      slots: {
        base: 'focus-visible:outline-primary focus-visible:outline-solid focus-visible:outline-3',
      },
    },
    input: {
      slots: {
        base: 'focus-visible:outline-primary focus-visible:outline-solid focus-visible:outline-3',
      },
    },
    select: {
      slots: {
        base: 'focus-visible:outline-primary focus-visible:outline-solid focus-visible:outline-3',
      },
    },
    selectMenu: {
      slots: {
        base: 'focus-visible:outline-primary focus-visible:outline-solid focus-visible:outline-3',
      },
    },
    textarea: {
      slots: {
        base: 'focus-visible:outline-primary focus-visible:outline-solid focus-visible:outline-3',
      },
    },
    checkbox: {
      slots: {
        base: 'focus-visible:outline-primary focus-visible:outline-solid focus-visible:outline-3',
      },
    },
    radioGroup: {
      slots: {
        base: 'focus-visible:outline-primary focus-visible:outline-solid focus-visible:outline-3',
      },
    },
    switch: {
      slots: {
        base: 'focus-visible:outline-primary focus-visible:outline-solid focus-visible:outline-3',
      },
    },
    // An inactive tab sits on bg-elevated, where text-muted is 4.39:1 in
    // light mode (DESIGN.md, Contrast): text-toned instead.
    tabs: {
      slots: {
        trigger: 'data-[state=inactive]:text-toned',
      },
    },
  },
});
