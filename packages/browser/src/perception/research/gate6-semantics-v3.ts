import type { Page } from "playwright";

export interface Gate6SurfaceFactsV3 {
  available: boolean;
  visibleChars: number;
  interactiveCount: number;
  primaryInteractiveCount: number;
  ariaBusyCount: number;
  iframeCount: number;

  metaContentContext: boolean;
  settingsContext: boolean;

  blockingDialogPresent: boolean;
  blockingDialogVerificationCue: boolean;

  activeVerificationDirective: boolean;
  semanticVerificationFrameOrdinals: number[];
  localVerificationFrameOrdinals: number[];

  authenticationDirectiveActive: boolean;
  credentialGateActive: boolean;
  identityChooserPresent: boolean;
  passkeyGateActive: boolean;

  restrictionBlockingCue: boolean;
  errorBlockingCue: boolean;

  visibleCanvasCount: number;
  interstitialCanvasPresented: boolean;
  nonInterstitialCanvasPresented: boolean;
}

export async function collectGate6SurfaceFactsV3(
  page: Page,
): Promise<Gate6SurfaceFactsV3> {
  return page.evaluate<Gate6SurfaceFactsV3>(`(() => {
    const visible = (element) => {
      if (!(element instanceof Element)) return false;

      let current = element;
      while (current instanceof Element) {
        const style = getComputedStyle(current);
        const opacity = Number.parseFloat(style.opacity || "1");

        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse" ||
          opacity === 0
        ) {
          return false;
        }

        current = current.parentElement;
      }

      const rect = element.getBoundingClientRect();

      if (rect.width <= 0 || rect.height <= 0) {
        return false;
      }

      return (
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < innerHeight &&
        rect.left < innerWidth
      );
    };

    const normalize = (value) =>
      String(value ?? "")
        .replace(/\\s+/g, " ")
        .trim()
        .toLowerCase();

    const visibleElements = (selector) =>
      Array.from(document.querySelectorAll(selector)).filter(visible);

    const renderedText = (element) => {
      if (element instanceof HTMLElement) {
        return element.innerText;
      }

      return element.textContent ?? "";
    };

    const verificationCue = (value) => {
      const text = normalize(value);

      return (
        /\\b(?:verify|verification|captcha|human check|human verification|security check|security challenge)\\b/.test(text) ||
        /\\b(?:robot|human)\\b.{0,70}\\b(?:check|challenge|verify|prove|confirm)\\b/.test(text) ||
        /\\b(?:prove|confirm|verify)\\b.{0,70}\\b(?:human|robot)\\b/.test(text) ||
        /\\bnot a robot\\b/.test(text)
      );
    };

    const verificationDirective = (value) => {
      const text = normalize(value);

      return (
        /^(?:please\\s+)?(?:verify|confirm)\\b.{0,110}\\b(?:human|robot)\\b/.test(text) ||
        /^(?:please\\s+)?complete\\b.{0,90}\\b(?:captcha|verification|security check|security challenge)\\b/.test(text) ||
        /^prove\\b.{0,90}\\b(?:not a robot|human)\\b/.test(text) ||
        /^(?:check|tick|select)\\b.{0,90}\\b(?:not a robot|human)\\b/.test(text)
      );
    };

    const verificationControlCue = (value) => {
      const text = normalize(value);

      return (
        verificationCue(text) ||
        /\\bi am (?:a )?human\\b/.test(text) ||
        /\\bi am not a robot\\b/.test(text)
      );
    };

    const authenticationCue = (value) => {
      const text = normalize(value);

      return (
        /\\b(?:sign|log) in\\b/.test(text) ||
        /\\bauthentication required\\b/.test(text) ||
        /\\bunlock (?:your )?(?:session|account)\\b/.test(text) ||
        /\\bsession locked\\b/.test(text) ||
        /\\baccess your (?:workspace|account)\\b/.test(text) ||
        /\\bcontinue with (?:an )?account\\b/.test(text) ||
        /\\bchoose (?:an )?account\\b/.test(text) ||
        /\\bselect (?:an )?identity\\b/.test(text) ||
        /\\bpasskey\\b/.test(text)
      );
    };

    const authenticationDirective = (value) => {
      const text = normalize(value);

      return (
        /^(?:please\\s+)?(?:sign|log) in(?:\\s+to\\s+continue)?\\b/.test(text) ||
        /^authentication required\\b/.test(text) ||
        /^unlock (?:your )?(?:session|account)\\b/.test(text) ||
        /^session locked\\b/.test(text) ||
        /^select (?:an )?identity(?:\\s+to\\s+continue)?\\b/.test(text) ||
        /^choose (?:an )?account\\b/.test(text) ||
        /^continue with (?:an )?account\\b/.test(text) ||
        /^continue with (?:your )?passkey\\b/.test(text)
      );
    };

    const restrictionCue = (value) => {
      const text = normalize(value);

      return (
        /\\b(?:access|requests?|connection|network|resource|workspace)\\b.{0,120}\\b(?:restricted|limited|denied|blocked|suspended|cannot be served|cannot continue)\\b/.test(text) ||
        /\\b(?:restricted|limited|denied|blocked|suspended|forbidden)\\b.{0,120}\\b(?:access|requests?|connection|network|resource|workspace)\\b/.test(text) ||
        /\\bunusual (?:activity|traffic)\\b/.test(text) ||
        /\\btoo many requests\\b/.test(text) ||
        /\\bunavailable for legal reasons\\b/.test(text)
      );
    };

    const errorCue = (value) => {
      const text = normalize(value);

      return (
        /\\bsomething went wrong\\b/.test(text) ||
        /\\bunexpected error\\b/.test(text) ||
        /\\bpage not found\\b/.test(text) ||
        /\\bnot found\\b/.test(text) ||
        /\\bbad gateway\\b/.test(text) ||
        /\\bservice unavailable\\b/.test(text) ||
        /\\bwe hit a snag\\b/.test(text) ||
        /\\b(?:application|page|view|service|dashboard)\\b.{0,110}\\b(?:could not|cannot|can't|failed to|unable to)\\b.{0,110}\\b(?:load|start|continue|display(?:ed)?)\\b/.test(text) ||
        /\\b(?:could not|cannot|can't|unable to)\\b.{0,60}\\b(?:load|display(?:ed)?|start)\\b/.test(text) ||
        /\\bunable to display\\b/.test(text)
      );
    };

    const interstitialCue = (value) => {
      const text = normalize(value);

      return (
        /\\bintervening\\b/.test(text) ||
        /\\binterstitial\\b/.test(text) ||
        /\\bintermediate step\\b/.test(text) ||
        /\\bcontinue in this browser window\\b/.test(text)
      );
    };

    const metaCue = (value) => {
      const text = normalize(value);

      return (
        /\\b(?:documentation|docs|guide|tutorial|example|examples|demo|integration|chapter|troubleshoot|troubleshooting|reference|article)\\b/.test(text) ||
        /^how to\\b/.test(text)
      );
    };

    const settingsCue = (value) => {
      const text = normalize(value);

      return /\\b(?:account settings|security settings|settings|preferences|profile|billing|change password|update password)\\b/.test(
        text,
      );
    };

    const headingElements = visibleElements("h1,h2,h3");
    const headingsText = headingElements
      .map((element) => element.textContent ?? "")
      .join(" ");

    const bodyText = document.body?.innerText ?? "";
    const contextText = [
      document.title,
      headingsText,
    ].join(" ");

    const metaContentContext = metaCue(contextText);
    const settingsContext = settingsCue(contextText);

    const dialogElements = visibleElements(
      '[role="dialog"],dialog[open],[aria-modal="true"]',
    );

    const blockingDialogs = dialogElements.filter((element) => {
      if (
        element.getAttribute("aria-modal") === "true" ||
        element.matches("dialog[open]")
      ) {
        return true;
      }

      const rect = element.getBoundingClientRect();

      return (
        rect.width * rect.height >=
        innerWidth * innerHeight * 0.25
      );
    });

    const blockingDialogPresent = blockingDialogs.length > 0;

    const controlSemanticText = (element) => {
      const id = element.getAttribute("id");
      const labels = [];

      if (id) {
        for (const label of document.querySelectorAll(
          'label[for="' + CSS.escape(id) + '"]',
        )) {
          labels.push(label.textContent ?? "");
        }
      }

      const closestLabel = element.closest("label");
      if (closestLabel) {
        labels.push(closestLabel.textContent ?? "");
      }

      labels.push(
        element.getAttribute("aria-label") ?? "",
        element.getAttribute("title") ?? "",
        element.textContent ?? "",
      );

      return labels.join(" ");
    };

    const blockingDialogVerificationCue = blockingDialogs.some(
      (dialog) => {
        if (verificationDirective(renderedText(dialog))) {
          return true;
        }

        return Array.from(
          dialog.querySelectorAll(
            'input[type="checkbox"],input[type="radio"],button,[role="button"]',
          ),
        )
          .filter(visible)
          .some((element) =>
            verificationControlCue(controlSemanticText(element)),
          );
      },
    );

    const directiveElements = visibleElements(
      "h1,h2,h3,p,label",
    );

    const activeVerificationDirective =
      !metaContentContext &&
      directiveElements.some((element) =>
        verificationDirective(element.textContent ?? ""),
      );

    const semanticVerificationFrameOrdinals = Array.from(
      document.querySelectorAll("iframe"),
    ).flatMap((frame, ordinal) => {
      const semanticName = [
        frame.getAttribute("title"),
        frame.getAttribute("aria-label"),
        frame.getAttribute("name"),
      ]
        .filter(Boolean)
        .join(" ");

      return verificationCue(semanticName)
        ? [ordinal]
        : [];
    });

    const localVerificationFrameOrdinals = Array.from(
      document.querySelectorAll("iframe"),
    ).flatMap((frame, ordinal) => {
      if (metaContentContext) {
        return [];
      }

      const container = frame.closest(
        'form,[role="dialog"],main,section,article',
      );

      if (!(container instanceof Element) || !visible(container)) {
        return [];
      }

      const localTexts = Array.from(
        container.querySelectorAll("h1,h2,h3,p,label"),
      )
        .filter(visible)
        .map((element) => element.textContent ?? "");

      return localTexts.some(verificationDirective)
        ? [ordinal]
        : [];
    });

    const inputs = visibleElements("input");
    const passwordInputs = inputs.filter(
      (element) =>
        normalize(element.getAttribute("type")) === "password",
    );
    const usernameLikeInputs = inputs.filter((element) => {
      const type = normalize(
        element.getAttribute("type") || "text",
      );
      const autocomplete = normalize(
        element.getAttribute("autocomplete"),
      );

      return (
        type === "email" ||
        autocomplete === "username"
      );
    });
    const credentialInputs = inputs.filter((element) => {
      const type = normalize(
        element.getAttribute("type") || "text",
      );
      const autocomplete = normalize(
        element.getAttribute("autocomplete"),
      );

      return (
        type === "email" ||
        type === "password" ||
        autocomplete === "username" ||
        autocomplete === "current-password"
      );
    });
    const newPasswordInputs = inputs.filter(
      (element) =>
        normalize(element.getAttribute("autocomplete")) ===
        "new-password",
    );

    const buttonElements = visibleElements(
      'button,[role="button"]',
    );
    const buttonTexts = buttonElements.map((element) =>
      normalize(controlSemanticText(element)),
    );

    const emailLikeChoices = buttonTexts.filter((text) =>
      /\\b[^\\s@]+@[^\\s@]+\\.[^\\s@]+\\b/.test(text),
    ).length;

    const authenticationDirectiveActive =
      !metaContentContext &&
      !settingsContext &&
      headingElements.some((element) =>
        authenticationDirective(element.textContent ?? ""),
      );

    const identityChooserPresent =
      !metaContentContext &&
      !settingsContext &&
      (
        emailLikeChoices >= 2 ||
        (
          headingElements.some((element) =>
            /(?:\\b(?:choose|select)\\b.{0,60}\\b(?:account|identity)\\b|\\bcontinue with (?:an )?account\\b)/.test(
              normalize(element.textContent ?? ""),
            ),
          ) &&
          buttonElements.length >= 2 &&
          credentialInputs.length === 0
        )
      );

    const credentialGateActive =
      !metaContentContext &&
      !settingsContext &&
      newPasswordInputs.length === 0 &&
      (
        (
          passwordInputs.length > 0 &&
          usernameLikeInputs.length > 0
        ) ||
        (
          passwordInputs.length > 0 &&
          headingElements.some((element) =>
            authenticationCue(element.textContent ?? ""),
          )
        )
      );

    const passkeyGateActive =
      !metaContentContext &&
      !settingsContext &&
      buttonTexts.some((text) =>
        /\\b(?:use|continue with|sign in with)\\b.{0,40}\\bpasskey\\b/.test(
          text,
        ),
      ) &&
      (
        headingElements.some((element) =>
          /\\bpasskey\\b/.test(
            normalize(element.textContent ?? ""),
          ),
        ) ||
        visibleElements("p").some((element) =>
          /\\bpasskey\\b/.test(
            normalize(element.textContent ?? ""),
          ),
        )
      );

    const alertElements = visibleElements('[role="alert"]');

    const interactiveElements = visibleElements(
      'a[href],button,input:not([type="hidden"]),textarea,select,[role="button"],[contenteditable="true"],[tabindex]',
    );

    const primaryInteractiveCount = interactiveElements.filter(
      (element) =>
        element.closest(
          '[role="dialog"],dialog[open],[aria-modal="true"],[role="alert"]',
        ) === null,
    ).length;

    const main = visibleElements("main")[0] ?? null;
    const mainText = main === null ? "" : renderedText(main);
    const mainRestrictionCue =
      main !== null && restrictionCue(mainText);
    const mainErrorCue =
      main !== null && errorCue(mainText);

    const alertRestrictionCue = alertElements.some((element) =>
      restrictionCue(renderedText(element)),
    );
    const alertErrorCue = alertElements.some((element) =>
      errorCue(renderedText(element)),
    );

    const rootAlert = alertElements.some(
      (element) =>
        element.matches("main") ||
        (
          main !== null &&
          element === main
        ),
    );

    const restrictionBlockingCue =
      !metaContentContext &&
      (
        mainRestrictionCue ||
        (
          alertRestrictionCue &&
          (
            rootAlert ||
            primaryInteractiveCount === 0
          )
        )
      );

    const errorBlockingCue =
      !metaContentContext &&
      (
        mainErrorCue ||
        (
          alertErrorCue &&
          (
            rootAlert ||
            primaryInteractiveCount === 0
          )
        )
      );

    let visibleCanvasCount = 0;
    let interstitialCanvasPresented = false;
    let nonInterstitialCanvasPresented = false;

    for (const canvas of visibleElements("canvas")) {
      visibleCanvasCount += 1;

      const labelledBy = canvas.getAttribute(
        "aria-labelledby",
      );
      const labelledText =
        labelledBy === null
          ? ""
          : labelledBy
              .split(/\\s+/)
              .map(
                (id) =>
                  document.getElementById(id)?.textContent ??
                  "",
              )
              .join(" ");

      const accessibleLabel = [
        canvas.getAttribute("aria-label"),
        labelledText,
        canvas.getAttribute("title"),
      ]
        .filter(Boolean)
        .join(" ");

      if (interstitialCue(accessibleLabel)) {
        interstitialCanvasPresented = true;
      } else {
        nonInterstitialCanvasPresented = true;
      }
    }

    return {
      available: true,
      visibleChars: bodyText.trim().length,
      interactiveCount: interactiveElements.length,
      primaryInteractiveCount,
      ariaBusyCount:
        document.querySelectorAll('[aria-busy="true"]').length,
      iframeCount:
        document.querySelectorAll("iframe").length,

      metaContentContext,
      settingsContext,

      blockingDialogPresent,
      blockingDialogVerificationCue,

      activeVerificationDirective,
      semanticVerificationFrameOrdinals,
      localVerificationFrameOrdinals,

      authenticationDirectiveActive,
      credentialGateActive,
      identityChooserPresent,
      passkeyGateActive,

      restrictionBlockingCue,
      errorBlockingCue,

      visibleCanvasCount,
      interstitialCanvasPresented,
      nonInterstitialCanvasPresented,
    };
  })()`);
}
