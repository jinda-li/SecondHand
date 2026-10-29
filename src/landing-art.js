// Drawings for the landing page: one hand-drawn isometric room (walls, floor, window) and the
// furniture, avatars and props placed in it. Plain SVG strings, rendered by landingHtml().

// <defs>: gradients, filters and one <symbol> per drawn thing (g-*) and avatar (av-*).
export const ROOM_DEFS = `<linearGradient id="gWallL" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#efe3cc"></stop><stop offset="1" stop-color="#e6d6b8"></stop></linearGradient>
<linearGradient id="gWallR" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f8f0df"></stop><stop offset="1" stop-color="#efe3c9"></stop></linearGradient>
<linearGradient id="gFloor" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ddb07a"></stop><stop offset="1" stop-color="#c8935c"></stop></linearGradient>
<linearGradient id="gSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe1df"></stop><stop offset="1" stop-color="#eef6ee"></stop></linearGradient>
<linearGradient id="gBeam" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff7dc" stop-opacity=".9"></stop><stop offset="1" stop-color="#fff7dc" stop-opacity="0"></stop></linearGradient>
<linearGradient id="gGlass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eef6f2"></stop><stop offset="1" stop-color="#b9d6cf"></stop></linearGradient>
<pattern id="pStripe" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(-28)"><rect width="6" height="12" fill="#e5b445"></rect><rect x="6" width="6" height="12" fill="#fffaf0"></rect></pattern>
<pattern id="pStripeR" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="6" height="12" fill="#e5b445"></rect><rect x="6" width="6" height="12" fill="#fffaf0"></rect></pattern>
<pattern id="pSpeck" width="22" height="14" patternUnits="userSpaceOnUse"><rect width="22" height="14" fill="#3f8a86"></rect><circle cx="4" cy="4" r="1.2" fill="#f6ecd8"></circle><circle cx="14" cy="9" r="1" fill="#e5b445"></circle><circle cx="19" cy="3" r=".9" fill="#f6ecd8"></circle></pattern>
<filter id="fBlur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"></feGaussianBlur></filter>
<filter id="fSoft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"></feGaussianBlur></filter>
<filter id="fShade" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3"></feGaussianBlur></filter>
<filter id="fGrain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="7" result="n"></feTurbulence><feColorMatrix in="n" type="matrix" values="0 0 0 0 0.42  0 0 0 0 0.28  0 0 0 0 0.16  0 0 0 1.3 -0.55" result="c"></feColorMatrix><feComposite in="c" in2="SourceGraphic" operator="in"></feComposite></filter>
<filter id="fWood" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.012 0.18" numOctaves="2" seed="3" result="n"></feTurbulence><feColorMatrix in="n" type="matrix" values="0 0 0 0 0.36  0 0 0 0 0.2  0 0 0 0 0.1  0 0 0 1.2 -0.5" result="c"></feColorMatrix><feComposite in="c" in2="SourceGraphic" operator="in"></feComposite></filter>
<symbol id="g-sofa" viewBox="0 0 190 160">
<g stroke="#5a3a2a" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">
<rect x="18" y="128" width="6" height="8" rx="2" fill="#7a4e32"></rect><rect x="50" y="146" width="6" height="8" rx="2" fill="#7a4e32"></rect><rect x="164" y="86" width="6" height="8" rx="2" fill="#7a4e32"></rect>
<polygon points="10,128 50,148 50,118 10,98" fill="#e2cfaa"></polygon>
<polygon points="50,148 170,88 170,58 50,118" fill="#efdcb8"></polygon>
<polygon points="10,98 130,38 170,58 50,118" fill="#f8ebcf"></polygon>
<polygon points="10,64 24,71 24,105 10,98" fill="#e2cfaa"></polygon>
<polygon points="24,71 144,11 144,45 24,105" fill="#f2e2c3"></polygon>
<polygon points="10,64 130,4 144,11 24,71" fill="#fbf2dd"></polygon>
<ellipse cx="72" cy="94" rx="33" ry="12" transform="rotate(-26.565 72 94)" fill="#cf5c45"></ellipse>
<ellipse cx="128" cy="66" rx="33" ry="12" transform="rotate(-26.565 128 66)" fill="#cf5c45"></ellipse>
<ellipse cx="62" cy="70" rx="14" ry="18" transform="rotate(-18 62 70)" fill="url(#pStripe)"></ellipse>
<ellipse cx="112" cy="44" rx="11" ry="15" transform="rotate(-18 112 44)" fill="#3f8a86"></ellipse>
</g>
<polyline points="54,114 166,58" fill="none" stroke="#ffffff" stroke-opacity=".6" stroke-width="2.4" stroke-linecap="round"></polyline>
<path d="M60 128 L150 83" stroke="#5a3a2a" stroke-opacity=".25" stroke-width="1.4" stroke-dasharray="3 4"></path>
</symbol>
<symbol id="g-shelf" viewBox="0 0 130 200">
<g stroke="#5a3a2a" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">
<polygon points="90,192 114,180 114,40 90,52" fill="#ad7444"></polygon>
<polygon points="30,162 90,192 90,52 30,22" fill="#c98d55"></polygon>
<polygon points="30,22 54,10 114,40 90,52" fill="#ddb07c"></polygon>
<polygon points="36,152 84,176 84,62 36,38" fill="#8a5a36"></polygon>
<polygon points="40,154 47,157.5 47,127.5 40,124" fill="#3f8a86"></polygon>
<polygon points="48,158 55,161.5 55,135.5 48,132" fill="#e5b445"></polygon>
<polygon points="56,162 63,165.5 63,133.5 56,130" fill="#cf5c45"></polygon>
<polygon points="66,167 73,170.5 73,142.5 66,139" fill="#f3e6cc"></polygon>
<polygon points="40,116 47,119.5 47,95.5 40,92" fill="#e5b445"></polygon>
<polygon points="48,120 55,123.5 55,97.5 48,94" fill="#cf5c45"></polygon>
<circle cx="72" cy="117" r="7.5" fill="#3f8a86"></circle>
<polygon points="42,79 49,82.5 49,52.5 42,49" fill="#93b86a"></polygon>
<polygon points="50,83 57,86.5 57,58.5 50,55" fill="#3f8a86"></polygon>
<ellipse cx="74" cy="82" rx="6" ry="9" fill="#fbf4e4"></ellipse>
<polygon points="36,114 84,138 84,143 36,119" fill="#ddb07c"></polygon>
<polygon points="36,76 84,100 84,105 36,81" fill="#ddb07c"></polygon>
<path d="M66 26 L80 26 L78 36 Q73 39 68 36 Z" fill="#cf5c45"></path>
<circle cx="70" cy="18" r="6" fill="#93b86a"></circle><circle cx="78" cy="20" r="5" fill="#7fa35a"></circle>
</g>
<polygon points="30,162 90,192 90,52 30,22" fill="#000000" filter="url(#fWood)" opacity=".5"></polygon>
</symbol>
<symbol id="g-desk" viewBox="0 0 150 150">
<g stroke="#5a3a2a" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">
<polygon points="135,76 141,73 141,120 135,123" fill="#9a653a"></polygon>
<polygon points="27,56 33,59 33,104 27,101" fill="#b47c48"></polygon>
<polygon points="101,96 107,99 107,142 101,139" fill="#b47c48"></polygon>
<polygon points="26,48 106,88 106,97 26,57" fill="#b47c48"></polygon>
<polygon points="106,88 142,70 142,79 106,97" fill="#9a653a"></polygon>
<polygon points="62,30 142,70 106,88 26,48" fill="#d9a56c"></polygon>
<polygon points="44,47 70,60 84,53 58,40" fill="#3f8a86"></polygon>
<polygon points="50,47 70,57 76,54 56,44" fill="#f3e6cc" stroke-width="1"></polygon>
<path d="M112 62 L120 62 L119 72 Q116 74 113 72 Z" fill="#fbf4e4"></path>
</g>
<polygon points="62,30 142,70 106,88 26,48" fill="#000000" filter="url(#fWood)" opacity=".55"></polygon>
<polyline points="30,49 104,86" fill="none" stroke="#ffffff" stroke-opacity=".45" stroke-width="2" stroke-linecap="round"></polyline>
</symbol>
<symbol id="g-lamp" viewBox="0 0 50 70">
<ellipse class="glow" cx="25" cy="40" rx="22" ry="14" fill="#ffe28a" filter="url(#fBlur)"></ellipse>
<g stroke="#5a3a2a" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">
<ellipse cx="25" cy="63" rx="11" ry="4.5" fill="#2f2a26"></ellipse>
<path d="M25 62 L25 36" fill="none" stroke="#2f2a26" stroke-width="3.2"></path>
<path d="M15 34 L35 34 L31 16 L19 16 Z" fill="#fbf0d4"></path>
<path d="M25 16 L31 16 L35 34 L27 34 Z" fill="#efdcb0" stroke="none"></path>
<path d="M17 16 L33 16 L30 10 L20 10 Z" fill="#2f2a26"></path>
<circle cx="25" cy="8" r="2" fill="#2f2a26"></circle>
<ellipse cx="25" cy="34" rx="10" ry="2.4" fill="#e5b445"></ellipse>
</g>
</symbol>
<symbol id="g-chair" viewBox="0 0 80 100">
<g stroke="#5a3a2a" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">
<polygon points="66,56 70,58 70,84 66,82" fill="#9a653a"></polygon>
<polygon points="10,62 14,64 14,88 10,86" fill="#b47c48"></polygon>
<polygon points="32,74 36,76 36,99 32,97" fill="#b47c48"></polygon>
<polygon points="34,70 70,52 70,58 34,76" fill="#2f726e"></polygon>
<polygon points="10,58 34,70 34,76 10,64" fill="#357c78"></polygon>
<polygon points="10,58 46,40 70,52 34,70" fill="#4a9a95"></polygon>
<polygon points="11,20 15,22 15,60 11,58" fill="#c98d55"></polygon>
<polygon points="29,29 33,31 33,69 29,67" fill="#c98d55"></polygon>
<polygon points="11,20 33,31 33,40 11,29" fill="#d9a56c"></polygon>
<polygon points="11,36 33,47 33,52 11,41" fill="#d9a56c"></polygon>
</g>
</symbol>
<symbol id="g-plant" viewBox="0 0 70 110">
<g class="leaves" stroke="#5a3a2a" stroke-width="1.6">
<circle cx="35" cy="38" r="17" fill="#7fa35a"></circle>
<circle cx="21" cy="52" r="14" fill="#93b86a"></circle>
<circle cx="49" cy="51" r="14" fill="#6b8f4a"></circle>
<circle cx="31" cy="22" r="11" fill="#a6c77b"></circle>
<circle cx="45" cy="28" r="10" fill="#93b86a"></circle>
<path d="M28 30 q4 -4 8 0 M40 44 q4 -4 8 0 M18 50 q4 -4 8 0" fill="none" stroke="#f3f7e6" stroke-opacity=".7" stroke-width="1.4"></path>
</g>
<g stroke="#5a3a2a" stroke-width="1.8" stroke-linejoin="round">
<path d="M33 74 L33 60 M37 74 L37 58" fill="none"></path>
<path d="M18 72 L52 72 L47 102 Q35 107 23 102 Z" fill="#c9553f"></path>
<path d="M20 80 L50 80 L49 87 L21 87 Z" fill="#f3e6cc"></path>
<ellipse cx="35" cy="72" rx="18" ry="5.5" fill="#d9694f"></ellipse>
</g>
</symbol>
<symbol id="g-mirror" viewBox="0 0 70 150">
<g transform="translate(0,24) skewY(-26.565)" stroke="#5a3a2a" stroke-width="1.8">
<rect x="14" y="20" width="40" height="108" rx="20" fill="#3f8a86"></rect>
<rect x="20" y="26" width="28" height="96" rx="14" fill="url(#gGlass)"></rect>
<path d="M26 50 L40 36 M26 64 L44 46" stroke="#ffffff" stroke-opacity=".85" stroke-width="3" stroke-linecap="round"></path>
<circle cx="34" cy="20" r="4" fill="#e5b445"></circle>
</g>
</symbol>
<symbol id="g-rug" viewBox="0 0 300 150">
<path d="M150 8 L292 75 L150 142 L8 75 Z" fill="#f3e6cc" stroke="#5a3a2a" stroke-width="2" stroke-linejoin="round"></path>
<path d="M150 20 L267 75 L150 130 L33 75 Z" fill="none" stroke="#3f8a86" stroke-width="6" stroke-linejoin="round"></path>
<path d="M150 38 L229 75 L150 112 L71 75 Z" fill="url(#pStripe)" stroke="#5a3a2a" stroke-width="1.6" stroke-linejoin="round"></path>
<circle cx="150" cy="75" r="9" fill="#cf5c45" stroke="#5a3a2a" stroke-width="1.6"></circle>
<g stroke="#5a3a2a" stroke-width="1.4" stroke-linecap="round"><path d="M8 75 l-6 3 M14 78 l-6 3 M20 81 l-6 3 M286 72 l6 -3 M280 69 l6 -3 M274 66 l6 -3"></path></g>
</symbol>
<filter id="fPatch" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3.5"></feGaussianBlur></filter>
<clipPath id="floorClip"><polygon points="60,440 380,280 700,440 380,600"></polygon></clipPath>
<symbol id="g-box" viewBox="0 0 60 56">
<g stroke="#5a3a2a" stroke-width="1.8" stroke-linejoin="round">
<polygon points="4,17 30,30 30,52 4,39" fill="#c99358"></polygon>
<polygon points="30,30 56,17 56,39 30,52" fill="#b07d47"></polygon>
<polygon points="30,4 56,17 30,30 4,17" fill="#e3b880"></polygon>
</g>
<path d="M17 10.5 L43 23.5" stroke="#f6e7c8" stroke-width="5" stroke-linecap="round"></path>
<path d="M10 33 l12 6" stroke="#5a3a2a" stroke-width="1.4" stroke-linecap="round" opacity=".5"></path>
</symbol>
<symbol id="g-keys" viewBox="0 0 48 30">
<g stroke="#5a3a2a" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">
<ellipse cx="14" cy="16" rx="9" ry="5" fill="none" stroke-width="2.4"></ellipse>
<path d="M20 19 L40 26 L42 23 L39 22 L40 20 L37 19 L38 17 L22 13 Z" fill="#e5b445"></path>
<circle cx="21" cy="16" r="3" fill="#e5b445"></circle>
<path d="M6 18 L4 27 L9 28 L10 20 Z" fill="#cf5c45"></path>
</g>
</symbol>
<!-- avatars, the kind people really use: a pet, a view, a selfie drawing -->
<symbol id="av-cat" viewBox="0 0 40 40"><rect width="40" height="40" fill="#f6dfb4"></rect><path d="M9 14 L12 4 L18 11 Z M31 14 L28 4 L22 11 Z" fill="#e0893f" stroke="#5a3a2a" stroke-width="1.2" stroke-linejoin="round"></path><ellipse cx="20" cy="22" rx="13" ry="12" fill="#e8964a" stroke="#5a3a2a" stroke-width="1.2"></ellipse><path d="M13 13 q3 3 0 6 M20 11 v5 M27 13 q-3 3 0 6" stroke="#c9732f" stroke-width="1.6" fill="none" stroke-linecap="round"></path><ellipse cx="20" cy="27" rx="7" ry="5" fill="#fbe9d2"></ellipse><circle cx="15" cy="21" r="1.8" fill="#2f2a26"></circle><circle cx="25" cy="21" r="1.8" fill="#2f2a26"></circle><path d="M18.6 25 h2.8 l-1.4 1.6 Z" fill="#e7738a"></path><rect y="36" width="40" height="4" fill="#cfe0f2"></rect></symbol>
<symbol id="av-hill" viewBox="0 0 40 40"><defs><linearGradient id="avSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7a072"></stop><stop offset="1" stop-color="#fbd38d"></stop></linearGradient></defs><rect width="40" height="40" fill="url(#avSky)"></rect><circle cx="27" cy="17" r="6" fill="#fff4d6"></circle><path d="M0 28 L10 18 L18 25 L26 16 L40 28 V40 H0 Z" fill="#3f6f73"></path><path d="M0 34 Q12 27 22 32 T40 31 V40 H0 Z" fill="#2c4f55"></path></symbol>
<symbol id="av-girl" viewBox="0 0 40 40"><rect width="40" height="40" fill="#cfe3f2"></rect><path d="M8 40 Q8 30 20 30 Q32 30 32 40 Z" fill="#e5b445"></path><path d="M9 24 Q8 8 20 8 Q32 8 31 24 L30 30 L10 30 Z" fill="#2f2a26"></path><ellipse cx="20" cy="21" rx="8.5" ry="9.5" fill="#f2c9a5"></ellipse><path d="M11 17 Q14 10 21 11 Q27 11 29 17 Q22 14 11 17 Z" fill="#2f2a26"></path><circle cx="16.5" cy="22" r="1.2" fill="#2f2a26"></circle><circle cx="23.5" cy="22" r="1.2" fill="#2f2a26"></circle><path d="M17.5 26 q2.5 2 5 0" stroke="#b9534a" stroke-width="1.2" fill="none" stroke-linecap="round"></path><circle cx="14" cy="25" r="1.6" fill="#f4a5a0" opacity=".7"></circle><circle cx="26" cy="25" r="1.6" fill="#f4a5a0" opacity=".7"></circle></symbol>
<symbol id="av-guy" viewBox="0 0 40 40"><rect width="40" height="40" fill="#e8e1d3"></rect><path d="M7 40 Q7 30 20 30 Q33 30 33 40 Z" fill="#3f8a86"></path><ellipse cx="20" cy="20" rx="8.5" ry="10" fill="#e7b98f"></ellipse><path d="M11 17 Q11 8 20 8 Q29 8 29 17 Q26 12 20 13 Q14 12 11 17 Z" fill="#3a2a20"></path><circle cx="16.3" cy="20.5" r="3" fill="none" stroke="#2f2a26" stroke-width="1.2"></circle><circle cx="23.7" cy="20.5" r="3" fill="none" stroke="#2f2a26" stroke-width="1.2"></circle><path d="M19.3 20.5 h1.4" stroke="#2f2a26" stroke-width="1.2"></path><circle cx="16.3" cy="20.5" r=".9" fill="#2f2a26"></circle><circle cx="23.7" cy="20.5" r=".9" fill="#2f2a26"></circle><path d="M18 26 h4" stroke="#8a4a3a" stroke-width="1.2" stroke-linecap="round"></path></symbol>
<symbol id="av-dog" viewBox="0 0 40 40"><rect width="40" height="40" fill="#bfe0c8"></rect><path d="M9 15 L11 5 L17 11 Z M31 15 L29 5 L23 11 Z" fill="#d98e46" stroke="#5a3a2a" stroke-width="1.2" stroke-linejoin="round"></path><ellipse cx="20" cy="22" rx="12.5" ry="12" fill="#e0a060" stroke="#5a3a2a" stroke-width="1.2"></ellipse><path d="M12 26 Q14 18 20 21 Q26 18 28 26 Q26 33 20 33 Q14 33 12 26 Z" fill="#fff7ec"></path><circle cx="15" cy="19" r="1.7" fill="#2f2a26"></circle><circle cx="25" cy="19" r="1.7" fill="#2f2a26"></circle><ellipse cx="20" cy="24" rx="2.2" ry="1.6" fill="#2f2a26"></ellipse><path d="M17.5 27 q2.5 2 5 0" stroke="#2f2a26" stroke-width="1.1" fill="none"></path></symbol>
<symbol id="av-bloom" viewBox="0 0 40 40"><rect width="40" height="40" fill="#f7d6dc"></rect><path d="M20 40 V24" stroke="#5f8f4a" stroke-width="2"></path><path d="M20 33 q-6 -2 -8 -7 q6 0 8 5 Z" fill="#7fa35a"></path><g fill="#fffaf0" stroke="#d98a9a" stroke-width="1"><ellipse cx="20" cy="12" rx="4" ry="6"></ellipse><ellipse cx="27" cy="17" rx="6" ry="4"></ellipse><ellipse cx="13" cy="17" rx="6" ry="4"></ellipse><ellipse cx="24" cy="23" rx="4.5" ry="4"></ellipse><ellipse cx="16" cy="23" rx="4.5" ry="4"></ellipse></g><circle cx="20" cy="18" r="3.4" fill="#e5b445"></circle></symbol>
<symbol id="av-me" viewBox="0 0 40 40"><rect width="40" height="40" fill="#ffe9a8"></rect><path d="M7 40 Q7 30 20 30 Q33 30 33 40 Z" fill="#0058a3"></path><ellipse cx="20" cy="20" rx="8.5" ry="10" fill="#f0c49c"></ellipse><path d="M11 18 Q10 7 20 7 Q31 7 29 18 Q27 11 19 12 Q14 12 11 18 Z" fill="#2f2a26"></path><circle cx="16.5" cy="21" r="1.2" fill="#2f2a26"></circle><circle cx="23.5" cy="21" r="1.2" fill="#2f2a26"></circle><path d="M17 25.5 q3 2.5 6 0" stroke="#8a4a3a" stroke-width="1.2" fill="none" stroke-linecap="round"></path></symbol>
`;

// The empty room in a 760×640 drawing; things and tags are layered on top of it.
export const ROOM_SHELL = `<ellipse cx="380" cy="614" rx="330" ry="34" fill="#6b4226" fill-opacity=".22" filter="url(#fSoft)"></ellipse>
<g stroke="#5a3a2a" stroke-width="1.8" stroke-linejoin="round">
<polygon points="60,452 380,612 380,634 60,474" fill="#3f8a86"></polygon>
<polygon points="380,612 700,452 700,474 380,634" fill="#2f726e"></polygon>
<polygon points="60,440 380,600 380,612 60,452" fill="#f6ecd8"></polygon>
<polygon points="380,600 700,440 700,452 380,612" fill="#e9dcc2"></polygon>
<polygon points="60,440 380,280 700,440 380,600" fill="url(#gFloor)"></polygon>
</g>
<polygon points="60,440 380,280 700,440 380,600" fill="#000000" filter="url(#fWood)" opacity=".45"></polygon>
<g stroke="#5a3a2a" stroke-opacity=".35" stroke-width="1.4">
<line x1="106" y1="417" x2="426" y2="577"></line><line x1="151" y1="394" x2="471" y2="554"></line><line x1="197" y1="371" x2="517" y2="531"></line><line x1="243" y1="349" x2="563" y2="509"></line><line x1="289" y1="326" x2="609" y2="486"></line><line x1="334" y1="303" x2="654" y2="463"></line>
<line x1="180" y1="402" x2="150" y2="417"></line><line x1="300" y1="402" x2="262" y2="421"></line><line x1="420" y1="430" x2="388" y2="446"></line><line x1="520" y1="470" x2="487" y2="486"></line><line x1="240" y1="470" x2="205" y2="487"></line>
</g>
<g stroke="#5a3a2a" stroke-width="1.8" stroke-linejoin="round">
<polygon points="60,440 380,280 380,20 60,180" fill="url(#gWallL)"></polygon>
<polygon points="380,280 700,440 700,180 380,20" fill="url(#gWallR)"></polygon>
</g>
<polygon points="60,440 380,280 380,20 60,180" fill="#000000" filter="url(#fGrain)" opacity=".35"></polygon>
<polygon points="380,280 700,440 700,180 380,20" fill="#000000" filter="url(#fGrain)" opacity=".28"></polygon>
<polygon points="60,180 380,20 380,280 60,440" fill="#5a3a2a" fill-opacity=".06"></polygon>
<g stroke="#5a3a2a" stroke-width="1.8" stroke-linejoin="round">
<polygon points="60,440 380,280 380,214 60,374" fill="#c9553f"></polygon>
<polygon points="380,280 700,440 700,374 380,214" fill="#d66650"></polygon>
<polygon points="60,374 380,214 380,202 60,362" fill="url(#pSpeck)"></polygon>
<polygon points="380,214 700,374 700,362 380,202" fill="url(#pSpeck)"></polygon>
</g>
<polygon points="60,440 380,280 380,214 60,374" fill="#000000" filter="url(#fGrain)" opacity=".3"></polygon>
<g transform="translate(60,440) skewY(-26.565)" stroke="#5a3a2a" stroke-width="1.3">
<rect x="20" y="-210" width="18" height="9" fill="#e7c4a6"></rect><rect x="40" y="-210" width="18" height="9" fill="#dcb393"></rect><rect x="30" y="-199" width="18" height="9" fill="#e7c4a6"></rect>
<rect x="262" y="-150" width="18" height="9" fill="#dcb393"></rect><rect x="282" y="-150" width="18" height="9" fill="#e7c4a6"></rect><rect x="272" y="-161" width="18" height="9" fill="#e7c4a6"></rect><rect x="272" y="-139" width="18" height="9" fill="#dcb393"></rect>
</g>
<g transform="translate(380,280) skewY(26.565)" stroke="#5a3a2a" stroke-width="1.3">
<rect x="200" y="-232" width="18" height="9" fill="#e7c4a6"></rect><rect x="220" y="-232" width="18" height="9" fill="#dcb393"></rect><rect x="210" y="-221" width="18" height="9" fill="#e7c4a6"></rect>
<rect x="182" y="-150" width="18" height="9" fill="#dcb393"></rect><rect x="192" y="-139" width="18" height="9" fill="#e7c4a6"></rect>
</g>
<g transform="translate(60,440) skewY(-26.565)" stroke="#5a3a2a" stroke-width="1.8" stroke-linejoin="round">
<path d="M112 -96 L112 -182 A58 58 0 0 1 228 -182 L228 -96 Z" fill="#3f8a86"></path>
<path d="M121 -104 L121 -182 A49 49 0 0 1 219 -182 L219 -104 Z" fill="url(#gSky)"></path>
<circle cx="196" cy="-196" r="10" fill="#fff6d6" stroke="none"></circle>
<path d="M138 -104 q10 -18 26 -10 q14 -16 30 -4 q12 -6 25 6 Z" fill="#a6c77b" stroke="none" opacity=".7"></path>
<path class="blind" d="M121 -182 A49 49 0 0 1 219 -182 L219 -158 Q209 -150 199 -158 Q189 -150 179 -158 Q169 -150 160 -158 Q150 -150 141 -158 Q131 -150 121 -158 Z" fill="url(#pStripeR)"></path>
<line x1="170" y1="-104" x2="170" y2="-226" stroke-width="3"></line>
<line x1="121" y1="-150" x2="219" y2="-150" stroke-width="3"></line>
<rect x="104" y="-98" width="132" height="8" rx="3" fill="#f6ecd8"></rect>
<g class="flowers">
<circle cx="122" cy="-102" r="7" fill="#7fa35a"></circle><circle cx="140" cy="-104" r="8" fill="#93b86a"></circle><circle cx="160" cy="-101" r="7" fill="#6b8f4a"></circle><circle cx="182" cy="-104" r="8" fill="#93b86a"></circle><circle cx="202" cy="-101" r="7" fill="#7fa35a"></circle><circle cx="220" cy="-103" r="7" fill="#93b86a"></circle>
<circle cx="130" cy="-108" r="3.6" fill="#cf5c45"></circle><circle cx="150" cy="-110" r="3.6" fill="#e5b445"></circle><circle cx="172" cy="-108" r="3.6" fill="#cf5c45"></circle><circle cx="194" cy="-110" r="3.6" fill="#fffaf0"></circle><circle cx="212" cy="-108" r="3.6" fill="#cf5c45"></circle>
</g>
<rect x="110" y="-90" width="120" height="18" rx="3" fill="#c9553f"></rect>
<path d="M118 -82 h104" stroke="#f6ecd8" stroke-width="2" stroke-dasharray="6 5"></path>
</g>
<g class="beam" opacity=".8" filter="url(#fPatch)">
<path d="M295 436.5 L393 387.5 L520 451 Q528 455 520 461 L442 500 Q430 506 420 499 Z" fill="#fff4d2" fill-opacity=".75"></path>
<path d="M344 412 L479 479.5 M346 462 L444 413" stroke="#c8935c" stroke-opacity=".35" stroke-width="7" stroke-linecap="round"></path>
</g>
<g transform="translate(455,122) skewY(26.565)" stroke="#5a3a2a" stroke-width="1.8">
<circle r="27" fill="#3f8a86"></circle>
<circle r="21" fill="#fbf4e4"></circle>
<circle r="2.8" fill="#2f2a26" stroke="none"></circle>
<line class="hand-m" x1="0" y1="-16" x2="0" y2="0" stroke="#2f2a26" stroke-width="2.6" stroke-linecap="round"></line>
<line class="hand-h" x1="0" y1="0" x2="11" y2="0" stroke="#cf5c45" stroke-width="3.4" stroke-linecap="round"></line>
</g>
<g transform="translate(668,262) skewY(26.565)" stroke="#5a3a2a" stroke-width="1.8" stroke-linejoin="round">
<rect x="-24" y="-20" width="48" height="40" rx="5" fill="#c9553f"></rect>
<rect x="-18" y="-14" width="36" height="28" rx="3" fill="#f6ecd8"></rect>
<circle cx="7" cy="-4" r="5" fill="#e5b445"></circle>
<path d="M-18 14 L-6 0 L4 10 L10 4 L18 14 Z" fill="#93b86a"></path>
</g>
<polyline points="60,440 60,180 380,20 700,180 700,440" fill="none" stroke="#5a3a2a" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"></polyline>
<polyline points="60,440 60,180 380,20 700,180 700,440" fill="none" stroke="#f6ecd8" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"></polyline>`;
