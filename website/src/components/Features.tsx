"use client";

import { motion } from "framer-motion";

// Shield icon with gradient fill - using Heroicons 2 ShieldCheck SVG path
const PrivacyIcon = () => (
  <div className="w-12 h-12 flex items-center justify-center">
    <div
      className="w-10 h-10 bg-gradient-to-br from-blue-500 to-violet-500"
      style={{
        WebkitMaskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='currentColor'%3E%3Cpath fill-rule='evenodd' d='M12.516 2.17a.75.75 0 00-1.032 0 11.209 11.209 0 01-7.877 3.08.75.75 0 00-.722.515A12.74 12.74 0 002.25 9.75c0 5.942 4.064 10.933 9.563 12.348a.749.749 0 00.374 0c5.499-1.415 9.563-6.406 9.563-12.348 0-1.39-.223-2.73-.635-3.985a.75.75 0 00-.722-.516 11.209 11.209 0 01-7.877-3.08zm3.274 7.04a.75.75 0 00-1.06-1.06L11 11.88l-1.47-1.47a.75.75 0 00-1.06 1.06l2 2a.75.75 0 001.06 0l4.26-4.26z' clip-rule='evenodd'/%3E%3C/svg%3E")`,
        WebkitMaskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='currentColor'%3E%3Cpath fill-rule='evenodd' d='M12.516 2.17a.75.75 0 00-1.032 0 11.209 11.209 0 01-7.877 3.08.75.75 0 00-.722.515A12.74 12.74 0 002.25 9.75c0 5.942 4.064 10.933 9.563 12.348a.749.749 0 00.374 0c5.499-1.415 9.563-6.406 9.563-12.348 0-1.39-.223-2.73-.635-3.985a.75.75 0 00-.722-.516 11.209 11.209 0 01-7.877-3.08zm3.274 7.04a.75.75 0 00-1.06-1.06L11 11.88l-1.47-1.47a.75.75 0 00-1.06 1.06l2 2a.75.75 0 001.06 0l4.26-4.26z' clip-rule='evenodd'/%3E%3C/svg%3E")`,
        maskSize: "contain",
        maskRepeat: "no-repeat",
      }}
    />
  </div>
);

// Wave icon with gradient - styled like 🌊 emoji
const UnifiedFeedIcon = () => (
  <div className="w-12 h-12 flex items-center justify-center">
    <div
      className="w-10 h-10 bg-gradient-to-tr from-blue-500 via-indigo-500 to-purple-500"
      style={{
        WebkitMaskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1'/%3E%3Cpath d='M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1'/%3E%3Cpath d='M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1'/%3E%3C/svg%3E")`,
        WebkitMaskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1'/%3E%3Cpath d='M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1'/%3E%3Cpath d='M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1'/%3E%3C/svg%3E")`,
        maskSize: "contain",
        maskRepeat: "no-repeat",
      }}
    />
  </div>
);

const FriendMapIcon = () => (
  <div className="w-12 h-12 flex items-center justify-center">
    <svg viewBox="0 0 48 48" className="w-10 h-10">
      <defs>
        <linearGradient id="mapGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <path
        d="M24 4C16.27 4 10 10.27 10 18c0 10.5 14 26 14 26s14-15.5 14-26c0-7.73-6.27-14-14-14z"
        fill="none"
        stroke="url(#mapGrad)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="24" cy="18" r="5" fill="url(#mapGrad)" />
      <circle cx="12" cy="36" r="2" fill="#6366f1" opacity="0.6" />
      <circle cx="36" cy="32" r="2" fill="#a855f7" opacity="0.6" />
      <circle cx="40" cy="40" r="1.5" fill="#8b5cf6" opacity="0.4" />
    </svg>
  </div>
);

// Siren face - elegant woman's profile with flowing hair (LoDi design)
const UlyssesIcon = () => (
  <div className="w-12 h-12">
    <svg viewBox="950 450 600 700" className="w-12 h-12">
      <defs>
        <linearGradient id="ulyssesGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
        <linearGradient id="ulyssesShadow" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4f46e5" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      {/* Main flowing hair and face */}
      <path
        fill="url(#ulyssesGrad)"
        d="M 581.954 803.804 C 611.718 790.537 631.212 781.44 656.128 759.218 C 691.32 727.83 716.732 686.618 742.583 647.677 C 790.896 574.904 860.755 514.025 946.581 491.451 C 980.621 482.498 1019.96 478.757 1052.21 495.465 C 1108.74 487.481 1144.95 505.278 1165.36 559.406 C 1184.1 572.8 1200.84 584.446 1215.05 603.11 C 1231.09 624.169 1238.71 654.847 1260.07 671.032 C 1273.85 680.639 1289.83 686.094 1305.96 690.377 C 1312.98 692.497 1323.1 694.232 1329.11 698.413 C 1347.43 711.17 1321.65 746.898 1338.15 760.613 C 1345.36 766.615 1352.11 761.308 1360.35 773.356 L 1360.98 774.263 C 1361.25 783.343 1360.89 789.272 1359.23 798.302 C 1381.68 804.149 1384.6 810.373 1372.04 830.804 L 1372.7 832.277 C 1381.15 850.841 1403.29 878.72 1393.9 899.227 C 1386.61 915.145 1352.92 927.712 1337.33 935.6 C 1277.78 965.718 1228.1 1006.86 1197.95 1067.74 C 1173.55 1117.02 1159.73 1171.15 1149.52 1225.04 C 1146.35 1241.27 1143.62 1271.3 1139.76 1284.99 C 1128.23 1178.97 1140 1087.18 1207.9 1000.02 C 1221.13 983.045 1243.74 962.261 1261.79 949.747 C 1216.6 952.612 1119.32 960.832 1103.23 902.313 C 1101.63 896.474 1109.93 890.943 1114.71 892.293 C 1129.59 896.496 1139.75 912.337 1155.5 916.466 C 1205.24 933.118 1329.92 919.603 1370.44 888.105 C 1365.31 866.753 1355.52 858.087 1346.58 839.029 C 1336.44 840.723 1285.22 846.901 1292.36 827.511 C 1297.19 814.371 1311.2 791.963 1318.15 777.719 C 1314.09 768.39 1312.42 759.4 1310.18 749.489 C 1305.27 757.763 1300.9 765.468 1290.84 768.168 C 1284.83 769.782 1279.24 766.963 1278.41 760.558 C 1276.56 746.438 1297.63 725.615 1307.49 717.368 C 1241.18 701.684 1228.44 685.227 1199.93 628.368 C 1180.25 589.111 1117.14 562.165 1073.71 561.335 C 1072.67 569.357 1071.11 579.308 1071.11 587.255 C 1071.25 628.529 1068.74 671.973 1057.1 711.668 C 1043.67 757.46 1019.33 798.104 991.589 836.42 C 982.572 848.875 978.66 853.193 982.586 869.509 C 989.19 896.954 1015.92 905.62 1041.13 899.349 C 1047.47 897.768 1061.54 894.16 1066.92 901.575 C 1080.63 927.36 1034.05 930.72 1021.5 930.123 C 994.458 928.836 972.735 913.516 961.003 890.414 C 959.242 886.886 957.528 883.334 955.863 879.76 C 857.882 996.874 741.914 1096.38 705.261 1249.17 C 694.506 1293.75 691.151 1339.79 695.33 1385.45 C 697.197 1406.64 702.358 1436.39 707.815 1456.98 C 690.826 1428.5 676.491 1385.75 672.045 1353.45 C 645.919 1163.66 793.632 1018.47 908.791 889.05 C 957.235 834.607 1005.34 775.469 1028.37 705.311 C 1000.47 756.402 979.39 790.42 939.819 833.545 C 824.083 959.676 700.983 1012.11 659.669 1189.09 C 651.88 1125.68 671.87 1065.28 711.167 1015.74 C 734.237 986.659 755.503 966.358 782.373 941.214 C 842.356 885.083 908.221 833.847 956.337 766.505 C 961.76 758.914 976.815 738.032 980.641 730.045 C 979.562 718.881 993.486 711.553 985.482 702.798 C 941.837 754.745 892.429 794.167 840.56 837.225 C 753.251 909.7 666.962 988.445 632.717 1100.36 C 613.972 1161.63 609.899 1222.7 621.871 1286.02 C 594.374 1240.22 589.596 1149.03 603.261 1098.93 C 619.828 1038.19 651.174 983.999 692.592 935.711 C 802.439 807.647 967.792 731.211 1037.4 569.008 C 1046.06 548.841 1060.57 520.861 1026.8 515.275 C 933.279 499.8 839.441 566.817 785.08 637.915 C 726.588 715.045 691.616 798.293 581.954 803.804 z"
      />
      {/* Shadow details */}
      <path
        fill="url(#ulyssesShadow)"
        d="M 985.482 702.798 C 994.641 691.331 1003.66 679.749 1012.53 668.057 C 1004.59 685.612 991.819 714.057 980.641 730.045 C 979.562 718.881 993.486 711.553 985.482 702.798 z"
      />
      <path
        fill="url(#ulyssesShadow)"
        d="M 1074.64 524.478 C 1073.61 520.819 1072.16 518.812 1074.22 515.668 C 1079.84 513 1087.74 516.367 1094.3 518.078 C 1085.71 522.853 1086.47 514.973 1074.64 524.478 z"
      />
      <path
        fill="url(#ulyssesShadow)"
        d="M 556.442 1041.15 C 564.014 1023.52 573.391 1006.73 584.423 991.032 C 584.319 1000.55 566.117 1028.79 561.26 1038.86 C 560.857 1039.7 557.486 1040.81 556.442 1041.15 z"
      />
      <path
        fill="url(#ulyssesShadow)"
        d="M 836.123 1056.73 C 843.499 1048.43 852.126 1040.81 860.471 1033.49 C 858.115 1040.82 855.733 1047.48 851.799 1054.12 C 842.212 1050.71 844.908 1057.57 836.123 1056.73 z"
      />
      {/* Additional hair strands */}
      <path
        fill="url(#ulyssesGrad)"
        d="M 1034.68 945.141 C 1061.66 944.102 1056.92 962.947 1053.1 983.806 C 1032.25 1097.76 943.712 1180.56 892.728 1281.13 C 850.092 1365.23 844.272 1454.04 875.638 1543.25 C 877.367 1548.18 886.917 1568.24 885.685 1571.93 L 883.189 1569.31 C 850.897 1528.74 830.024 1478.52 827.796 1426.5 C 823.861 1334.65 866.071 1257.47 916.342 1184.3 C 956.03 1126.53 1000.71 1067.53 1019.34 999.219 C 1023.84 982.707 1025.13 970.019 1026.83 953.301 C 1029.07 950.372 1032.01 947.726 1034.68 945.141 z"
      />
      <path
        fill="url(#ulyssesGrad)"
        d="M 539.691 1090.77 C 540.497 1053.31 551.724 1010.35 569.04 977.299 C 578.638 958.893 590.241 941.604 603.637 925.747 C 624.66 900.623 645.951 880.385 668.474 856.791 C 697.67 825.679 726.668 794.382 755.466 762.902 C 780.656 735.317 805.366 707.297 829.586 678.855 C 854.858 649.497 879.723 619.699 908.12 593.22 C 916.738 585.698 931.981 567.196 944.768 575.987 C 965.625 591.028 934.581 607.439 924.879 617.404 C 865.368 678.532 812.626 745.762 754.216 808.075 C 730.192 833.796 705.724 859.098 680.822 883.969 C 649.711 914.834 606.904 954.169 584.423 991.032 C 584.319 1000.55 566.117 1028.79 561.26 1038.86 C 560.857 1039.7 557.486 1040.81 556.442 1041.15 C 549.831 1056.66 544.592 1074.54 539.691 1090.77 z"
      />
      <path
        fill="url(#ulyssesGrad)"
        d="M 955.725 919.11 C 971.49 917.284 979.332 923.736 975.07 940.053 C 951.486 1028.57 893.004 1104.74 846.332 1182.73 C 792.459 1272.74 774.903 1345.31 767.782 1448.24 C 767.496 1450.9 767.202 1452.77 766.739 1455.36 L 765.823 1455.88 C 763.709 1451.55 761.949 1440.78 760.959 1435.62 C 753.342 1397.12 752.804 1357.55 759.372 1318.86 C 782.604 1185.91 892.571 1082.99 938.492 958.896 C 943.56 945.201 943.528 927.645 955.725 919.11 z"
      />
      <path
        fill="url(#ulyssesGrad)"
        d="M 1081.98 928.095 C 1105.16 927.618 1101.09 947.907 1102.21 965.219 C 1103.7 988.364 1101.22 1012.69 1096.75 1035.43 C 1078.21 1125.48 1024.91 1204.59 948.411 1255.59 C 943.091 1258.91 939.414 1260.66 933.772 1263.35 C 1008.94 1172.52 1086.44 1072.34 1072.09 947.03 C 1070.88 936.536 1072.98 932.862 1081.98 928.095 z"
      />
      <path
        fill="url(#ulyssesGrad)"
        d="M 836.123 1056.73 C 844.908 1057.57 842.212 1050.71 851.799 1054.12 C 832.059 1095.02 803.421 1137.14 781.757 1177.71 C 764.143 1210.7 753.906 1234.46 741.872 1269.77 C 740.243 1192.53 783.862 1111.76 836.123 1056.73 z"
      />
      {/* Face features */}
      <path
        fill="url(#ulyssesGrad)"
        d="M 1168.71 631.336 C 1177.61 630.279 1186.72 630.85 1190.37 641.753 C 1191.38 644.779 1189.9 648.029 1188.15 650.75 C 1183.39 658.175 1173.69 657.18 1166.12 659.087 C 1151.28 661.795 1139.31 667.765 1127.84 677.647 C 1116.28 687.591 1110.41 700.889 1101.9 713.38 C 1098.56 715.045 1089.46 716.312 1086.55 713.752 C 1075.04 703.636 1086.38 685.169 1093.45 675.717 C 1112.95 649.647 1136.8 636.081 1168.71 631.336 z"
      />
      <path
        fill="url(#ulyssesGrad)"
        d="M 1182.44 677.322 C 1193.21 678.998 1197.69 693.63 1209 701.805 C 1216.1 701.861 1226.75 700.744 1230.83 707.811 C 1230.8 710.624 1230.77 712.343 1228.55 714.836 C 1211.87 733.613 1191.78 742.383 1168.23 745.859 C 1156.7 746.842 1129.07 750.758 1133.76 728.129 C 1135.77 718.447 1150.75 719.316 1158.91 718.992 C 1172.17 718.467 1180.88 715.905 1192.89 710.012 C 1186.8 699.946 1179.96 689.25 1182.44 677.322 z"
      />
    </svg>
  </div>
);

// Sync icon - using Lucide RefreshCw pattern with gradient
const SyncIcon = () => (
  <div className="w-12 h-12 flex items-center justify-center">
    <div
      className="w-10 h-10 bg-gradient-to-br from-blue-500 to-violet-500"
      style={{
        WebkitMaskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8'/%3E%3Cpath d='M21 3v5h-5'/%3E%3Cpath d='M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16'/%3E%3Cpath d='M3 21v-5h5'/%3E%3C/svg%3E")`,
        WebkitMaskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8'/%3E%3Cpath d='M21 3v5h-5'/%3E%3Cpath d='M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16'/%3E%3Cpath d='M3 21v-5h5'/%3E%3C/svg%3E")`,
        maskSize: "contain",
        maskRepeat: "no-repeat",
      }}
    />
  </div>
);

const OpenSourceIcon = () => (
  <div className="w-12 h-12 flex items-center justify-center">
    <svg viewBox="4 6 40 40" className="w-10 h-10">
      <defs>
        <linearGradient id="ossGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <path
        d="M24 8C14.06 8 6 16.06 6 26c0 7.18 4.69 13.27 11.18 15.38.82.15 1.12-.36 1.12-.79v-2.77c-4.55.99-5.51-2.19-5.51-2.19-.74-1.89-1.81-2.39-1.81-2.39-1.48-1.01.11-.99.11-.99 1.64.12 2.5 1.68 2.5 1.68 1.46 2.5 3.82 1.78 4.75 1.36.15-1.06.57-1.78 1.04-2.19-3.63-.41-7.45-1.82-7.45-8.08 0-1.78.64-3.24 1.68-4.38-.17-.41-.73-2.07.16-4.32 0 0 1.37-.44 4.48 1.67 1.3-.36 2.69-.54 4.08-.55 1.38.01 2.78.19 4.08.55 3.11-2.11 4.47-1.67 4.47-1.67.89 2.25.33 3.91.16 4.32 1.05 1.14 1.68 2.6 1.68 4.38 0 6.28-3.82 7.66-7.46 8.07.59.51 1.11 1.5 1.11 3.03v4.49c0 .44.29.95 1.13.79C37.31 39.27 42 33.18 42 26c0-9.94-8.06-18-18-18z"
        fill="url(#ossGrad)"
      />
    </svg>
  </div>
);

const features = [
  {
    icon: <PrivacyIcon />,
    title: "Local-First Privacy",
    description:
      "All your data stays on your device. No servers, no tracking, no telemetry. Your feed, your control.",
  },
  {
    icon: <UnifiedFeedIcon />,
    title: "Unified Feed",
    description:
      "One feed to rule them all. X, Facebook, Instagram—combined and weighted by what matters to you.",
  },
  {
    icon: <FriendMapIcon />,
    title: "Friend Map",
    description:
      "See where your friends are in real life. Location extraction from posts and stories builds a live map.",
  },
  {
    icon: <UlyssesIcon />,
    title: "Ulysses Mode",
    description:
      "Bind yourself to your values. Block algorithmic feeds and only engage through Freed.",
  },
  {
    icon: <SyncIcon />,
    title: "Cross-Device Sync",
    description:
      "CRDT-powered sync across all your devices. No cloud required—peer-to-peer when you want it.",
  },
  {
    icon: <OpenSourceIcon />,
    title: "Open Source",
    description:
      "MIT licensed. Fork it, audit it, improve it. Built by humans who are Open to Source.",
  },
];

export default function Features() {
  return (
    <section
      id="features"
      className="py-16 sm:py-24 px-4 sm:px-6 md:px-12 lg:px-8"
    >
      <div className="max-w-6xl mx-auto">
        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
            >
              <div className="glass-card p-6 h-full">
                <div className="mb-4">{feature.icon}</div>
                <h3 className="text-xl font-semibold text-text-primary mb-2">
                  {feature.title}
                </h3>
                <p className="text-text-secondary">{feature.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
