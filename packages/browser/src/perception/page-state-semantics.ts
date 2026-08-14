// Promoted from the independently confirmed S4R7 semantic collector.
// Research files remain frozen; production parity is enforced by conformance tests.

import type { Page } from "playwright";

export type PageStateSurfaceKind =
  "primary" | "blocking_dialog" | "alert" | "supplementary";

export interface PageStateSemanticSurface {
  id: string;
  kind: PageStateSurfaceKind;
  blocking: boolean;

  visibleChars: number;
  interactiveCount: number;
  semanticChars: number;

  metaContext: boolean;
  documentRoleContext?: boolean;
  settingsContext: boolean;
  workflowUnavailable: boolean;

  verificationDirective: boolean;
  verificationControl: boolean;
  semanticVerificationFrameOrdinals: number[];
  localVerificationFrameOrdinals: number[];

  authenticationDirective: boolean;
  credentialGate: boolean;
  identityChooser: boolean;
  passkeyGate: boolean;

  restrictionCue: boolean;
  errorCue: boolean;
}

export interface PageStateSurfaceFacts {
  available: boolean;
  ariaBusyCount: number;
  iframeCount: number;

  primaryVisibleChars: number;
  primaryInteractiveCount: number;

  documentVerificationFrameOrdinals: number[];
  surfaces: PageStateSemanticSurface[];

  visibleCanvasCount: number;
  interstitialCanvasPresented: boolean;
  nonInterstitialCanvasPresented: boolean;
}

export async function collectPageStateSurfaceFacts(
  page: Page,
): Promise<PageStateSurfaceFacts> {
  return page.evaluate<PageStateSurfaceFacts>(`(() => {
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

    const renderedText = (element) => {
      if (element instanceof HTMLElement) {
        return element.innerText;
      }

      return element.textContent ?? "";
    };

    const visibleElements = (selector, root = document) =>
      Array.from(root.querySelectorAll(selector)).filter(visible);

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
        /\\bauthenticate to continue\\b/.test(text) ||
        /\\bunlock (?:your )?(?:session|account)\\b/.test(text) ||
        /\\bsession (?:expired|locked)\\b/.test(text) ||
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
        /^authenticate to continue\\b/.test(text) ||
        /^unlock (?:your )?(?:session|account)\\b/.test(text) ||
        /^session (?:expired|locked)\\b/.test(text) ||
        /^select (?:an )?identity(?:\\s+to\\s+continue)?\\b/.test(text) ||
        /^choose (?:an )?account\\b/.test(text) ||
        /^continue with (?:an )?account\\b/.test(text) ||
        /^continue with (?:your )?passkey\\b/.test(text)
      );
    };

    const restrictionCue = (value) => {
      const text = normalize(value);

      return (
        /\\b(?:access|requests?|connection|network|resource|workspace)\\b.{0,120}\\b(?:restricted|limited|denied|blocked|suspended|cannot be served)\\b/.test(text) ||
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
        /\\bapplication unavailable\\b/.test(text) ||
        /\\bwe hit a snag\\b/.test(text) ||
        /\\b(?:application|page|view|service|dashboard|workspace)\\b.{0,110}\\b(?:could not|cannot|can't|failed to|unable to)\\b.{0,110}\\b(?:load|start|continue|display(?:ed)?|open)\\b/.test(text) ||
        /\\b(?:could not|cannot|can't|unable to)\\b.{0,60}\\b(?:load|display(?:ed)?|start|open)\\b/.test(text)
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
        /\\b(?:documentation|docs|guide|tutorial|chapter|reference|handbook|troubleshoot|troubleshooting)\\b/.test(text) ||
        /\\bunderstanding\\b.{0,80}\\b(?:error|failure|challenge|verification|restriction)\\b/.test(text) ||
        /\\b(?:example|demo|sample)\\b.{0,80}\\b(?:widget|integration|configuration|flow|code|copy|markup|provider)\\b/.test(text) ||
        /\\b(?:widget|integration|configuration|flow|code|copy|markup|provider)\\b.{0,80}\\b(?:example|demo|sample)\\b/.test(text)
      );
    };

    const titleMetaCue = (value) => {
      const text = normalize(value);
      const words = text.split(" ").filter(Boolean);

      const documentTypes = [
        "documentation",
        "docs",
        "tutorial",
        "reference",
        "handbook",
        "guide",
      ];

      if (words.length === 0) return false;

      if (
        words.includes("troubleshoot") ||
        words.includes("troubleshooting")
      ) return true;

      if (documentTypes.includes(words.at(-1) ?? "")) return true;

      if (
        words[0] === "guide" &&
        (words[1] === "to" || words[1] === "for")
      ) return true;

      if (
        words[0] === "chapter" &&
        words.length > 1 &&
        Number.isFinite(Number(words[1]))
      ) return true;

      return false;
    };

    const workflowUnavailableCue = (value) => {
      const text = normalize(value);
      return (
        text.includes(" unavailable") ||
        text.startsWith("unavailable ") ||
        text.includes("cannot currently be accessed") ||
        text.includes("not currently available") ||
        text.includes("access is unavailable")
      );
    };
    const settingsCue = (value) => {
      const text = normalize(value);

      return /\\b(?:account settings|security settings|settings|preferences|profile|billing|change password|update password)\\b/.test(
        text,
      );
    };

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

    const boundarySelector =
      '[role="dialog"],dialog[open],[aria-modal="true"],aside,footer,nav,section,[role="alert"]';

    const belongsToSurface = (node, root, kind) => {
      if (!(node instanceof Element)) {
        return false;
      }

      if (kind === "blocking_dialog") {
        return root.contains(node);
      }

      const boundary = node.closest(boundarySelector);

      if (boundary === null) {
        return root.contains(node);
      }

      return boundary === root;
    };

    const semanticTextFor = (root, kind) => {
      if (kind === "blocking_dialog") {
        return renderedText(root);
      }

      const parts = [];

      for (const element of visibleElements(
        "h1,h2,h3,p,label,button,[role=button]",
        root,
      )) {
        if (!belongsToSurface(element, root, kind)) {
          continue;
        }

        const text = renderedText(element).trim();

        if (text.length > 0) {
          parts.push(text);
        }
      }

      if (parts.length > 0) {
        return parts.join(" ");
      }

      if (kind === "primary") {
        const direct = Array.from(root.children)
          .filter((child) => visible(child))
          .filter(
            (child) =>
              !child.matches(boundarySelector),
          )
          .map((child) => renderedText(child).trim())
          .filter(Boolean);

        if (direct.length > 0) {
          return direct.join(" ");
        }
      }

      return "";
    };

    const headingsFor = (root, kind) =>
      visibleElements("h1,h2,h3", root)
        .filter((element) =>
          belongsToSurface(element, root, kind),
        )
        .map((element) => renderedText(element))
        .join(" ");

    const interactiveFor = (root, kind) =>
      visibleElements(
        'a[href],button,input:not([type="hidden"]),textarea,select,[role="button"],[contenteditable="true"],[tabindex]',
        root,
      ).filter((element) =>
        belongsToSurface(element, root, kind),
      );

    const iframeOrdinalsFor = (root, kind) =>
      Array.from(document.querySelectorAll("iframe")).flatMap(
        (frame, ordinal) =>
          root.contains(frame) &&
          belongsToSurface(frame, root, kind)
            ? [ordinal]
            : [],
      );

    const makeSurface = (
      root,
      id,
      kind,
      blocking,
    ) => {
      const semanticText = semanticTextFor(root, kind);
      const headingText = headingsFor(root, kind);
      const controls = interactiveFor(root, kind);
      const frameOrdinals = iframeOrdinalsFor(root, kind);

      const documentHeadingCount =
        kind === "primary"
          ? visibleElements("h1,h2,h3", root).length
          : 0;

      const documentCodeCount =
        kind === "primary"
          ? visibleElements("pre,code", root).length
          : 0;

      const docsLikePath =
        kind === "primary" &&
        /\\/(?:docs?|documentation|reference|manual|guides?)(?:\\/|$)/.test(
          location.pathname.toLowerCase(),
        );

      const documentRoleContext =
        docsLikePath &&
        (documentHeadingCount >= 3 || documentCodeCount >= 3);

      const inputs = controls.filter(
        (element) => element.tagName === "INPUT",
      );

      const passwordInputs = inputs.filter(
        (element) =>
          normalize(element.getAttribute("type")) ===
          "password",
      );

      const usernameLikeInputs = inputs.filter((element) => {
        const type = normalize(
          element.getAttribute("type") || "text",
        );
        const autocomplete = normalize(
          element.getAttribute("autocomplete"),
        );
        const semanticText = normalize(
          controlSemanticText(element),
        );

        return (
          type === "email" ||
          autocomplete === "username" ||
          /\\b(?:username|user name|user id|email(?: address)?)\\b/.test(
            semanticText,
          )
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

      const buttonElements = controls.filter(
        (element) =>
          element.matches('button,[role="button"]'),
      );

      const buttonTexts = buttonElements.map((element) =>
        normalize(controlSemanticText(element)),
      );

      const emailLikeChoices = buttonTexts.filter((text) =>
        /\\b[^\\s@]+@[^\\s@]+\\.[^\\s@]+\\b/.test(text),
      ).length;

      const verificationControl = controls.some(
        (element) =>
          element.matches(
            'input[type="checkbox"],input[type="radio"],button,[role="button"]',
          ) &&
          verificationControlCue(
            controlSemanticText(element),
          ),
      );

      const semanticVerificationFrameOrdinals =
        frameOrdinals.filter((ordinal) => {
          const frame =
            document.querySelectorAll("iframe")[ordinal];

          if (!(frame instanceof HTMLIFrameElement)) {
            return false;
          }

          const semanticName = [
            frame.getAttribute("title"),
            frame.getAttribute("aria-label"),
            frame.getAttribute("name"),
          ]
            .filter(Boolean)
            .join(" ");

          return verificationCue(semanticName);
        });

      const verificationDirectivePresent =
        visibleElements("h1,h2,h3,p,label", root)
          .filter((element) =>
            belongsToSurface(element, root, kind),
          )
          .some((element) =>
            verificationDirective(
              renderedText(element),
            ),
          );

      const localVerificationFrameOrdinals =
        verificationDirectivePresent
          ? frameOrdinals
          : [];

      const authenticationDirectivePresent =
        visibleElements("h1,h2,h3,p", root)
          .filter((element) =>
            belongsToSurface(element, root, kind),
          )
          .some((element) =>
            authenticationDirective(
              renderedText(element),
            ),
          );

      const identityChooser =
        emailLikeChoices >= 2 ||
        (
          visibleElements("h1,h2,h3", root)
            .filter((element) =>
              belongsToSurface(element, root, kind),
            )
            .some((element) =>
              /(?:\\b(?:choose|select)\\b.{0,60}\\b(?:account|identity)\\b|\\bcontinue with (?:an )?account\\b)/.test(
                normalize(renderedText(element)),
              ),
            ) &&
          buttonElements.length >= 2 &&
          credentialInputs.length === 0
        );

      const credentialGate =
        newPasswordInputs.length === 0 &&
        (
          (
            passwordInputs.length > 0 &&
            usernameLikeInputs.length > 0
          ) ||
          (
            passwordInputs.length > 0 &&
            authenticationCue(
              headingText + " " + semanticText,
            )
          )
        );

      const passkeyGate =
        buttonTexts.some((text) =>
          /\\b(?:use|continue with|sign in with)\\b.{0,40}\\bpasskey\\b/.test(
            text,
          ),
        ) &&
        /\\bpasskey\\b/.test(
          normalize(headingText + " " + semanticText),
        );

      return {
        id,
        kind,
        blocking,
        visibleChars: renderedText(root).trim().length,
        interactiveCount: controls.length,
        semanticChars: semanticText.trim().length,
        metaContext:
          kind === "primary"
            ? titleMetaCue(document.title) ||
              metaCue(headingText)
            : metaCue(headingText),
        documentRoleContext,
        settingsContext: settingsCue(headingText),
        workflowUnavailable:
          kind === "primary" &&
          workflowUnavailableCue(headingText + " " + semanticText),
        verificationDirective:
          verificationDirectivePresent,
        verificationControl,
        semanticVerificationFrameOrdinals,
        localVerificationFrameOrdinals,
        authenticationDirective:
          authenticationDirectivePresent,
        credentialGate,
        identityChooser,
        passkeyGate,
        restrictionCue:
          restrictionCue(semanticText),
        errorCue:
          errorCue(semanticText),
      };
    };

    const primary =
      visibleElements("main")[0] ??
      document.body;

    const surfaces = [];

    if (primary instanceof Element) {
      surfaces.push(
        makeSurface(
          primary,
          "primary",
          "primary",
          false,
        ),
      );
    }

    const dialogs = visibleElements(
      '[role="dialog"],dialog[open],[aria-modal="true"]',
    );

    dialogs.forEach((dialog, index) => {
      const rect = dialog.getBoundingClientRect();
      const blocking =
        dialog.getAttribute("aria-modal") === "true" ||
        dialog.matches("dialog[open]") ||
        rect.width * rect.height >=
          innerWidth * innerHeight * 0.25;

      if (blocking) {
        surfaces.push(
          makeSurface(
            dialog,
            "dialog:" + index,
            "blocking_dialog",
            true,
          ),
        );
      }
    });

    const supplemental = visibleElements(
      "aside,footer,section,[role=alert]",
    ).filter(
      (element) =>
        element !== primary &&
        !dialogs.some((dialog) =>
          dialog.contains(element),
        ),
    );

    supplemental.forEach((element, index) => {
      const kind =
        element.getAttribute("role") === "alert"
          ? "alert"
          : "supplementary";

      surfaces.push(
        makeSurface(
          element,
          kind + ":" + index,
          kind,
          false,
        ),
      );
    });

    const surfaceOwnedFrameOrdinals = new Set(
      surfaces.flatMap((surface) => [
        ...surface.semanticVerificationFrameOrdinals,
        ...surface.localVerificationFrameOrdinals,
      ]),
    );

    const documentVerificationFrameOrdinals =
      Array.from(
        document.querySelectorAll("iframe"),
      ).flatMap((frame, ordinal) => {
        if (
          surfaceOwnedFrameOrdinals.has(ordinal) ||
          frame.closest(boundarySelector) !== null
        ) {
          return [];
        }

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

    const primarySurface = surfaces.find(
      (surface) => surface.kind === "primary",
    );

    return {
      available: true,
      ariaBusyCount:
        document.querySelectorAll('[aria-busy="true"]').length,
      iframeCount:
        document.querySelectorAll("iframe").length,
      primaryVisibleChars:
        primarySurface?.visibleChars ?? 0,
      primaryInteractiveCount:
        primarySurface?.interactiveCount ?? 0,
      documentVerificationFrameOrdinals,
      surfaces,
      visibleCanvasCount,
      interstitialCanvasPresented,
      nonInterstitialCanvasPresented,
    };
  })()`);
}
