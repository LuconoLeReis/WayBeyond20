// Presentation only: native React controls never leave their original parents.
// Choosing a rest opens DDB's pane, never its completion/confirmation control.
let wb20HeaderRestMenu = null;
let wb20HeaderDismissInstalled = false;

function wb20HeaderCloseRest(restoreFocus = false) {
    if (!wb20HeaderRestMenu) return;
    const {button, menu} = wb20HeaderRestMenu;
    menu.hidden = true; button.setAttribute("aria-expanded", "false");
    wb20HeaderRestMenu = null;
    if (restoreFocus && button.isConnected) button.focus({preventScroll:true});
}

function wb20HeaderNative(header, kind) {
    return kind === "manage" ? header.querySelector('.ddbc-character-tidbits__menu-callout button') :
        header.querySelector(`.ct-character-header-desktop__group--${kind} .ct-character-header-desktop__button`);
}

function wb20HeaderOpenNative(header, kind) {
    const path = location.pathname;
    // Finish the proxy click before opening a native sidebar. Otherwise DDB's
    // outside-click handler can immediately dismiss what the proxy just opened.
    setTimeout(() => {
        if (header.isConnected && path === location.pathname) wb20HeaderNative(header,kind)?.click();
    },0);
}

function wb20HeaderKeyboard(control) {
    if (!control || control._wb20HeaderKeyboard) return;
    control._wb20HeaderKeyboard = true;
    if (!control.hasAttribute("tabindex")) control.tabIndex = 0;
    if (!control.hasAttribute("role")) control.setAttribute("role", "button");
    control.addEventListener("keydown", event => {
        if (event.target === control && ["Enter", " "].includes(event.key)) {
            event.preventDefault(); event.stopPropagation(); control.click();
        }
    });
}

function wb20HeaderTheme(header) {
    if (typeof wayBeyond20ApplySheetTheme !== "function") return;
    // Sample the same native sheet surface used by Combat and Portent. Work on
    // a detached node so unchanged theme refreshes do not retrigger observers.
    const sample = document.createElement("div");
    wayBeyond20ApplySheetTheme(sample);
    if (!sample.style.color) return;
    const properties = {
        "--wb20-header-ink": sample.style.color,
        "--wb20-header-surface": sample.style.getPropertyValue("--wb20-sheet-surface"),
        "--wb20-header-border": sample.style.getPropertyValue("--wb20-sheet-accent"),
        "--wb20-header-frame": sample.style.backgroundImage || "none",
        "--wb20-header-radius": sample.style.borderRadius || "4px"
    };
    for (const [name,value] of Object.entries(properties)) {
        if (value && header.style.getPropertyValue(name) !== value) header.style.setProperty(name,value);
    }
    if (typeof wb20ThemeResourcePrompt === "function") document.querySelectorAll('.wb20-resource-dialog').forEach(wb20ThemeResourcePrompt);
}

function wb20RefreshCompactHeader() {
    for (const header of document.querySelectorAll(".ct-character-header-desktop")) {
        const wb20 = header.querySelector(":scope > .ct-character-header-desktop__group--beyond20");
        const share = header.querySelector(":scope > .ct-character-header-desktop__group--share");
        if (!wb20 || !share || !wb20HeaderNative(header,"short-rest") || !wb20HeaderNative(header,"long-rest") || !wb20HeaderNative(header,"manage")) continue;
        if (!header.classList.contains("wb20-compact-header")) header.classList.add("wb20-compact-header");
        wb20HeaderTheme(header);
        let manage = header.querySelector(":scope > .wb20-header-manage");
        if (manage && !manage._wb20HeaderBound) {manage.remove();manage=null;}
        if (!manage) {
            manage = document.createElement("div"); manage.className = "wb20-header-manage";
            manage._wb20HeaderBound = true;
            const button = document.createElement("button"); button.type = "button"; button.textContent = "Manage";
            button.title = "Manage character";
            button.addEventListener("click", event => {
                event.preventDefault(); event.stopPropagation(); wb20HeaderCloseRest();
                wb20HeaderOpenNative(header,"manage");
            });
            manage.append(button); header.append(manage);
        }
        wb20HeaderKeyboard(wb20.querySelector(".ct-beyond20-settings-button"));
        let rest = header.querySelector(":scope > .wb20-header-rest");
        if (rest && !rest._wb20HeaderBound) {rest.remove();rest=null;}
        if (!rest) {
            rest = document.createElement("div"); rest.className = "wb20-header-rest";
            rest._wb20HeaderBound = true;
            const button = document.createElement("button"); button.type = "button"; button.textContent = "Rest";
            button.setAttribute("aria-haspopup","menu"); button.setAttribute("aria-expanded","false");
            button.title = "Choose a rest. Nothing is spent or reset until you confirm in the DDB rest window.";
            const menu = document.createElement("div"); menu.className = "wb20-header-rest-menu";
            menu.hidden = true; menu.setAttribute("role","menu"); menu.setAttribute("aria-label","Choose rest");
            for (const [kind,name] of [["short-rest","Short Rest"],["long-rest","Long Rest"]]) {
                const choice = document.createElement("button"); choice.type = "button"; choice.textContent = name;
                choice.setAttribute("role","menuitem");
                choice.addEventListener("click", event => {
                    event.preventDefault(); event.stopPropagation();
                    const opened = wb20HeaderRestMenu;
                    const valid = opened?.menu === menu && opened.path === location.pathname && header.isConnected;
                    wb20HeaderCloseRest();
                    // The native sidebar closes on outside clicks; wait for this click to finish.
                    if (valid) wb20HeaderOpenNative(header,kind);
                });
                menu.append(choice);
            }
            button.addEventListener("click", event => {
                event.preventDefault(); event.stopPropagation();
                const opened = !menu.hidden; wb20HeaderCloseRest();
                if (opened || !header.isConnected) return;
                menu.hidden = false; button.setAttribute("aria-expanded","true");
                wb20HeaderRestMenu = {button,menu,path:location.pathname};
                menu.querySelector("button")?.focus({preventScroll:true});
            });
            menu.addEventListener("keydown", event => {
                if (!["ArrowDown","ArrowUp"].includes(event.key)) return;
                event.preventDefault();
                const choices = Array.from(menu.querySelectorAll("button")), index = choices.indexOf(document.activeElement);
                choices[(index + (event.key === "ArrowDown" ? 1 : choices.length - 1)) % choices.length].focus();
            });
            rest.append(button,menu); header.append(rest);
        }
        const campaign = header.querySelector('[data-testid="campaign-summary"]')?.parentElement;
        const showCorrection=typeof character === "undefined" || character?.getSetting("waybeyond20-resource-correction",true) !== false;
        if (!showCorrection) rest.querySelector('.wb20-resource-correction-button')?.remove();
        if (showCorrection && !rest.querySelector('.wb20-resource-correction-button') && typeof wb20CorrectResources === "function") {
            const correction=document.createElement('button');correction.type='button';correction.className='wb20-resource-correction-button';correction.textContent='Correction';
            correction.addEventListener('click',()=>{wb20HeaderCloseRest();wb20CorrectResources().catch(error=>{console.warn('WayBeyond20: Correction failed',error);alertify.warning('Correction did not finish. Reopen it to check the current counts.');});});
            rest.append(correction);
        }
        if (campaign?.parentElement === header) {
            if (campaign.getAttribute("data-wb20-header-role") !== "campaign") campaign.setAttribute("data-wb20-header-role","campaign");
            const log = campaign.querySelector('[role="button"][aria-roledescription="Game Log"]');
            if (log && !log.hasAttribute("aria-label")) log.setAttribute("aria-label","Game Log");
            wb20HeaderKeyboard(log);
        }
    }
    if (wb20HeaderRestMenu && (!wb20HeaderRestMenu.button.isConnected || wb20HeaderRestMenu.path !== location.pathname)) wb20HeaderCloseRest();
    if (!wb20HeaderDismissInstalled) {
        wb20HeaderDismissInstalled = true;
        document.addEventListener("click", event => {
            if (wb20HeaderRestMenu && !event.target.closest?.(".wb20-header-rest")) wb20HeaderCloseRest();
        });
        document.addEventListener("keydown", event => {
            if (event.key === "Escape" && wb20HeaderRestMenu) {event.preventDefault(); wb20HeaderCloseRest(true);}
        });
        window.addEventListener("resize", () => wb20HeaderCloseRest());
        // DDB can switch a sheet theme by changing attributes without replacing
        // any children. The main sheet observer intentionally ignores attributes.
        const themeObserver = new MutationObserver(records => {
            const native = document.querySelector('.ct-saving-throws-box,.ddbc-saving-throws-box,.ct-ability-summary,.ddbc-ability-summary');
            if (native && records.some(({target}) => native.contains(target) || target.contains(native))) wb20RefreshCompactHeader();
        });
        themeObserver.observe(document.documentElement, {subtree:true,attributes:true,attributeFilter:["class","style","fill"]});
    }
}
