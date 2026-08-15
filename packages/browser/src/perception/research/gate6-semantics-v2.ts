import type { Page } from "playwright";

export interface Gate6AccessibilityFactsV2 {
  available: boolean;
  verificationCue: boolean;
  authenticationCue: boolean;
  restrictionCue: boolean;
  errorCue: boolean;
  dialogCount: number;
  iframeCount: number;
}

export interface Gate6SurfaceFactsV2 {
  available: boolean;
  visibleChars: number;
  interactiveCount: number;
  ariaBusyCount: number;
  iframeCount: number;

  blockingDialogPresent: boolean;
  alertSurfacePresent: boolean;

  verificationSurfaceCue: boolean;
  verificationDirectiveHeading: boolean;
  verificationControlPresent: boolean;
  semanticVerificationFrameOrdinals: number[];
  directiveVerificationFrameOrdinals: number[];

  authenticationSurfaceCue: boolean;
  authenticationDirectiveHeading: boolean;
  credentialInputCount: number;
  passwordInputCount: number;
  usernameLikeInputCount: number;
  newPasswordInputCount: number;
  identityChooserPresent: boolean;

  restrictionSurfaceCue: boolean;
  restrictionAlertCue: boolean;

  errorAlertCue: boolean;

  visibleCanvasCount: number;
  interstitialCanvasPresented: boolean;
  nonInterstitialCanvasPresented: boolean;
}

export async function collectGate6SurfaceFactsV2(
  page: Page,
): Promise<Gate6SurfaceFactsV2> {
  return page.evaluate<Gate6SurfaceFactsV2>(`(() => {
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

    const verificationCue = (value) => {
      const text = normalize(value);

      return (
        /\\b(?:verify|verification|captcha|human check|human verification|security check|security challenge)\\b/.test(text) ||
        /\\b(?:robot|human)\\b.{0,60}\\b(?:check|challenge|verify|prove|confirm)\\b/.test(text) ||
        /\\b(?:prove|confirm|verify)\\b.{0,60}\\b(?:human|robot)\\b/.test(text) ||
        /\\bnot a robot\\b/.test(text)
      );
    };

    const verificationDirective = (value) => {
      const text = normalize(value);

      if (
        /^(?:how|why|when|where|understanding|guide|tutorial|example|examples|learn|learning)\\b/.test(
          text,
        )
      ) {
        return false;
      }

      return (
        /^(?:please\\s+)?(?:verify|confirm)\\b.{0,90}\\b(?:human|robot)\\b/.test(
          text,
        ) ||
        /^(?:please\\s+)?complete\\b.{0,80}\\b(?:captcha|verification|security check|security challenge)\\b.{0,90}\\b(?:continue|proceed|submit|move on)\\b/.test(
          text,
        ) ||
        /^prove\\b.{0,80}\\b(?:not a robot|you(?:'|’)re not a robot|you are not a robot)\\b/.test(
          text,
        ) ||
        /^(?:check|tick|select)\\b.{0,80}\\b(?:not a robot|human)\\b/.test(
          text,
        )
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
        /\\baccount credentials\\b/.test(text)
      );
    };

    const authenticationDirective = (value) => {
      const text = normalize(value);

      return (
        /^(?:please\\s+)?(?:sign|log) in(?:\\s+to\\s+continue)?\\b/.test(text) ||
        /^authentication required\\b/.test(text) ||
        /^unlock (?:your )?(?:session|account)\\b/.test(text) ||
        /^session locked\\b/.test(text) ||
        /^select (?:an )?identity to continue\\b/.test(text) ||
        /^choose (?:an )?account\\b/.test(text)
      );
    };

    const restrictionCue = (value) => {
      const text = normalize(value);

      return (
        /\\b(?:access|requests?|connection|network|resource)\\b.{0,100}\\b(?:restricted|limited|denied|blocked|suspended|cannot be served|cannot continue)\\b/.test(text) ||
        /\\b(?:restricted|limited|denied|blocked|suspended|forbidden)\\b.{0,100}\\b(?:access|requests?|connection|network|resource)\\b/.test(text) ||
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
        /\\bbad gateway\\b/.test(text) ||
        /\\bservice unavailable\\b/.test(text) ||
        /\\bwe hit a snag\\b/.test(text) ||
        /\\b(?:application|page|view|service)\\b.{0,100}\\b(?:could not|cannot|can't|failed to|unable to)\\b.{0,100}\\b(?:load|start|continue|display)\\b/.test(text) ||
        /\\b(?:could not|cannot|can't) be displayed\\b/.test(text)
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

    const visibleElements = (selector) =>
      Array.from(document.querySelectorAll(selector)).filter(visible);

    const headingElements = visibleElements("h1,h2,h3");
    const headingText = headingElements
      .map((element) => element.textContent ?? "")
      .join(" ");

    const alertElements = visibleElements('[role="alert"]');
    const alertText = alertElements
      .map((element) => element.textContent ?? "")
      .join(" ");

    const dialogElements = visibleElements(
      '[role="dialog"],dialog[open],[aria-modal="true"]',
    );

    const blockingDialogPresent = dialogElements.some((element) => {
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

    const inputs = visibleElements("input");
    const credentialInputs = inputs.filter((element) => {
      const input = element;
      const type = normalize(input.getAttribute("type") || "text");
      const autocomplete = normalize(input.getAttribute("autocomplete"));

      return (
        type === "email" ||
        type === "password" ||
        autocomplete === "username" ||
        autocomplete === "current-password"
      );
    });

    const passwordInputs = inputs.filter((element) => {
      const input = element;
      return normalize(input.getAttribute("type")) === "password";
    });

    const usernameLikeInputs = inputs.filter((element) => {
      const input = element;
      const type = normalize(input.getAttribute("type") || "text");
      const autocomplete = normalize(input.getAttribute("autocomplete"));

      return (
        type === "email" ||
        autocomplete === "username"
      );
    });

    const newPasswordInputs = inputs.filter((element) => {
      const input = element;
      return normalize(input.getAttribute("autocomplete")) === "new-password";
    });

    const buttonElements = visibleElements('button,[role="button"]');
    const buttonTexts = buttonElements.map((element) =>
      normalize(
        element.getAttribute("aria-label") ||
          element.textContent ||
          "",
      ),
    );

    const emailLikeChoices = buttonTexts.filter((text) =>
      /\\b[^\\s@]+@[^\\s@]+\\.[^\\s@]+\\b/.test(text),
    ).length;

    const authenticationSurfaceCue = authenticationCue(headingText);

    const identityChooserPresent =
      emailLikeChoices >= 2 ||
      (
        authenticationSurfaceCue &&
        buttonElements.length >= 2 &&
        credentialInputs.length === 0
      );

    const controlElements = visibleElements(
      'input[type="checkbox"],input[type="radio"],button,[role="button"]',
    );

    const verificationControlPresent = controlElements.some((element) => {
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

      return verificationCue(labels.join(" "));
    });

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

    const directiveVerificationFrameOrdinals = Array.from(
      document.querySelectorAll("iframe"),
    ).flatMap((frame, ordinal) => {
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

    let visibleCanvasCount = 0;
    let interstitialCanvasPresented = false;
    let nonInterstitialCanvasPresented = false;

    for (const canvas of visibleElements("canvas")) {
      visibleCanvasCount += 1;

      const labelledBy = canvas.getAttribute("aria-labelledby");
      const labelledText =
        labelledBy === null
          ? ""
          : labelledBy
              .split(/\\s+/)
              .map(
                (id) =>
                  document.getElementById(id)?.textContent ?? "",
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

    const interactiveCount = visibleElements(
      'a[href],button,input:not([type="hidden"]),textarea,select,[role],[contenteditable="true"],[tabindex]',
    ).length;

    return {
      available: true,
      visibleChars: (document.body?.innerText ?? "").trim().length,
      interactiveCount,
      ariaBusyCount:
        document.querySelectorAll('[aria-busy="true"]').length,
      iframeCount:
        document.querySelectorAll("iframe").length,

      blockingDialogPresent,
      alertSurfacePresent: alertElements.length > 0,

      verificationSurfaceCue:
        verificationCue(headingText) ||
        dialogElements.some((element) =>
          verificationCue(element.textContent ?? ""),
        ) ||
        alertElements.some((element) =>
          verificationCue(element.textContent ?? ""),
        ),
      verificationDirectiveHeading:
        headingElements.some((element) =>
          verificationDirective(element.textContent ?? ""),
        ),
      verificationControlPresent,
      semanticVerificationFrameOrdinals,
      directiveVerificationFrameOrdinals,

      authenticationSurfaceCue,
      authenticationDirectiveHeading:
        headingElements.some((element) =>
          authenticationDirective(element.textContent ?? ""),
        ),
      credentialInputCount: credentialInputs.length,
      passwordInputCount: passwordInputs.length,
      usernameLikeInputCount: usernameLikeInputs.length,
      newPasswordInputCount: newPasswordInputs.length,
      identityChooserPresent,

      restrictionSurfaceCue: restrictionCue(
        headingText + " " + alertText,
      ),
      restrictionAlertCue:
        alertElements.length > 0 &&
        restrictionCue(alertText),

      errorAlertCue:
        alertElements.length > 0 &&
        errorCue(alertText),

      visibleCanvasCount,
      interstitialCanvasPresented,
      nonInterstitialCanvasPresented,
    };
  })()`);
}

export async function collectGate6AccessibilityFactsV2(
  page: Page,
): Promise<Gate6AccessibilityFactsV2> {
  let snapshot: string;

  try {
    snapshot = await page.locator("body").ariaSnapshot();
  } catch {
    return {
      available: false,
      verificationCue: false,
      authenticationCue: false,
      restrictionCue: false,
      errorCue: false,
      dialogCount: 0,
      iframeCount: 0,
    };
  }

  const text = snapshot.toLowerCase();

  const verificationCue =
    /\b(?:verify|verification|captcha|human check|security check|security challenge)\b/.test(
      text,
    ) ||
    /\bnot a robot\b/.test(text) ||
    /\bprove\b.{0,60}\brobot\b/.test(text);

  const authenticationCue =
    /\b(?:sign|log) in\b/.test(text) ||
    /\bunlock (?:your )?(?:session|account)\b/.test(text) ||
    /\bsession locked\b/.test(text) ||
    /\bcontinue with (?:an )?account\b/.test(text) ||
    /\bselect (?:an )?identity\b/.test(text);

  const restrictionCue =
    /\b(?:restricted|limited|denied|blocked|suspended|forbidden)\b/.test(
      text,
    ) || /\bunavailable for legal reasons\b/.test(text);

  const errorCue =
    /\bsomething went wrong\b/.test(text) ||
    /\bwe hit a snag\b/.test(text) ||
    /\bpage not found\b/.test(text) ||
    /\bbad gateway\b/.test(text) ||
    /\bservice unavailable\b/.test(text);

  const roleCount = (role: string) =>
    snapshot.match(new RegExp(`^\\s*-\\s+${role}(?:\\s|:|$)`, "gim"))?.length ??
    0;

  return {
    available: true,
    verificationCue,
    authenticationCue,
    restrictionCue,
    errorCue,
    dialogCount: roleCount("dialog"),
    iframeCount: roleCount("iframe"),
  };
}
