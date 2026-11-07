// A COMPANY'S TIME ZONE FROM WHERE IT IS (owner, 2026-11-07: a California shop sat on the default New York zone, so
// its reminders ran on Eastern time and a 10 AM visit read as 1 PM). Pure. Read off the business address's state
// when the address has one ("…, Riverside, CA 92501"), else off the phone's area code ("951" is Riverside County).
// A state that straddles two zones gets the zone most of its people live in. Null when neither says.

export const DEFAULT_TIMEZONE = "America/New_York";

const ET = "America/New_York";
const CT = "America/Chicago";
const MT = "America/Denver";
const AZ = "America/Phoenix";
const PT = "America/Los_Angeles";
const AK = "America/Anchorage";
const HI = "Pacific/Honolulu";

/** Each state's zone — the one most of it keeps (Texas Central, Florida Eastern, Idaho Mountain, Oregon Pacific…). */
const STATE_ZONE: Record<string, string> = {
  AL: CT, AK: AK, AZ: AZ, AR: CT, CA: PT, CO: MT, CT: ET, DE: ET, DC: ET, FL: ET, GA: ET, HI: HI, ID: MT, IL: CT, IN: ET,
  IA: CT, KS: CT, KY: ET, LA: CT, ME: ET, MD: ET, MA: ET, MI: ET, MN: CT, MS: CT, MO: CT, MT: MT, NE: CT, NV: PT, NH: ET,
  NJ: ET, NM: MT, NY: ET, NC: ET, ND: CT, OH: ET, OK: CT, OR: PT, PA: ET, RI: ET, SC: ET, SD: CT, TN: CT, TX: CT, UT: MT,
  VT: ET, VA: ET, WA: PT, WV: ET, WI: CT, WY: MT, PR: "America/Puerto_Rico",
};

/** US area codes by zone. A code in two zones goes with its larger side. */
const AREA_ZONE: Record<string, string> = {};
const codes = (zone: string, list: string) => {
  for (const c of list.split(/\s+/).filter(Boolean)) AREA_ZONE[c] = zone;
};
codes(PT, "209 213 279 310 323 341 350 369 408 415 424 442 510 530 559 562 619 626 628 650 657 661 669 707 714 747 760 805 818 820 831 840 858 909 916 925 949 951 " + "206 253 360 425 509 564 " + "458 503 541 971 " + "702 725 775 " + "208 986");
codes(MT, "303 719 720 970 983 " + "505 575 " + "385 435 801 " + "406 " + "307 " + "605 " + "701 " + "308 " + "915 ");
codes(AZ, "480 520 602 623 928");
codes(CT, "205 251 256 334 938 " + "479 501 870 " + "217 224 309 312 331 447 464 618 630 708 773 779 815 847 872 " + "319 515 563 641 712 " + "316 620 785 913 " + "225 318 337 504 985 " + "218 320 507 612 651 763 952 " + "228 601 662 769 " + "314 417 557 573 636 660 816 975 " + "402 531 " + "405 539 572 580 918 " + "605 " + "615 629 731 865 901 931 423 " + "210 214 254 281 325 346 361 409 430 432 469 512 682 713 726 737 806 817 830 832 903 936 940 945 956 972 979 " + "262 274 414 534 608 715 920");
codes(ET, "203 475 860 959 " + "302 " + "202 " + "239 305 321 352 386 407 448 561 656 689 727 754 772 786 813 850 863 904 941 954 " + "229 404 470 478 678 706 762 770 912 943 " + "219 260 317 463 574 765 812 930 " + "270 364 502 606 859 " + "207 " + "227 240 301 410 443 667 " + "339 351 413 508 617 774 781 857 978 " + "231 248 269 313 517 586 616 679 734 810 906 947 989 " + "603 " + "201 551 609 640 732 848 856 862 908 973 " + "212 315 332 347 363 516 518 585 607 631 646 680 716 718 838 845 914 917 929 934 " + "252 336 472 704 743 828 910 919 980 984 " + "216 220 234 283 326 330 380 419 440 513 567 614 740 937 " + "215 223 267 272 412 445 484 570 582 610 717 724 814 835 878 " + "401 " + "803 839 843 854 864 " + "802 " + "276 434 540 571 703 757 804 826 948 " + "304 681 " + "423");
codes(AK, "907");
codes(HI, "808");
codes("America/Puerto_Rico", "787 939");

/** "…, Riverside, CA 92501" → "CA"; the two letters right before the ZIP, or at the very end. */
export function stateFromAddress(address: string | null | undefined): string | null {
  const a = (address ?? "").toUpperCase();
  if (!a.trim()) return null;
  const beforeZip = a.match(/\b([A-Z]{2})\b[ ,.]*\d{5}(?:-\d{4})?\b/);
  if (beforeZip && STATE_ZONE[beforeZip[1]]) return beforeZip[1];
  const atEnd = a.match(/\b([A-Z]{2})\b\s*(?:,?\s*(?:USA|US|UNITED STATES))?\s*$/);
  if (atEnd && STATE_ZONE[atEnd[1]]) return atEnd[1];
  return null;
}

export function timezoneForState(state: string | null | undefined): string | null {
  return state ? (STATE_ZONE[state.toUpperCase()] ?? null) : null;
}

/** "(951) 388-7747" → "951". */
export function areaCodeOf(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits.length === 10 ? digits : null;
  return ten ? ten.slice(0, 3) : null;
}

export function timezoneForAreaCode(phone: string | null | undefined): string | null {
  const code = areaCodeOf(phone);
  return code ? (AREA_ZONE[code] ?? null) : null;
}

/** The zone a company most likely keeps: its address's state first, else its phone's area code; null when neither says. */
export function timezoneFor(input: { address?: string | null; phone?: string | null }): string | null {
  return timezoneForState(stateFromAddress(input.address)) ?? timezoneForAreaCode(input.phone);
}

/** The zone to set on a company whose zone was never chosen (still the default): what its address or phone says, when
 *  that differs from the default. Null = leave it. */
export function timezoneFixFor(current: string | null | undefined, input: { address?: string | null; phone?: string | null }): string | null {
  if (current && current !== DEFAULT_TIMEZONE) return null;
  const tz = timezoneFor(input);
  return tz && tz !== DEFAULT_TIMEZONE ? tz : null;
}
