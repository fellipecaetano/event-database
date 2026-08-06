export interface SiteMessages {
  readonly navigation: {
    readonly upcoming: string;
    readonly history: string;
    readonly historyYears: string;
  };
  readonly list: {
    readonly liveMusic: string;
    readonly noEvents: string;
    readonly intro: string;
    readonly noResults: string;
    readonly clearSearch: string;
    readonly searchLabel: string;
    readonly upcomingTitle: string;
    readonly pastTitle: string;
    readonly yearTitle: (year: string) => string;
  };
  readonly event: {
    readonly venue: string;
    readonly start: string;
    readonly show: string;
    readonly end: string;
    readonly lineup: string;
    readonly genres: string;
    readonly price: string;
    readonly timeToConfirm: string;
    readonly venueToConfirm: string;
    readonly happeningNow: string;
  };
  readonly status: {
    readonly cancelled: string;
    readonly postponed: string;
    readonly soldOut: string;
  };
  readonly tickets: {
    readonly buy: string;
    readonly atDoor: string;
    readonly available: string;
  };
  readonly metadata: {
    readonly description: string;
  };
  readonly footer: {
    readonly updatedAt: (value: string) => string;
  };
}

export const localeMessages = {
  "pt-BR": {
    navigation: {
      upcoming: "Próximos",
      history: "Histórico",
      historyYears: "Anos do histórico",
    },
    list: {
      liveMusic: "Música ao vivo",
      noEvents: "Ainda não há eventos nesta seleção.",
      intro: "Shows e festas para marcar na agenda.",
      noResults: "Nenhum evento encontrado.",
      clearSearch: "Limpar busca",
      searchLabel: "Buscar por artista, local ou gênero",
      upcomingTitle: "Próximos eventos",
      pastTitle: "Eventos passados",
      yearTitle: (year: string): string => `Eventos de ${year}`,
    },
    event: {
      venue: "Local",
      start: "Início",
      show: "Show",
      end: "Fim",
      lineup: "Line-up",
      genres: "Gêneros",
      price: "Preço",
      timeToConfirm: "Horário a confirmar",
      venueToConfirm: "Local a confirmar",
      happeningNow: "Acontecendo agora",
    },
    status: {
      cancelled: "Cancelado",
      postponed: "Adiado",
      soldOut: "Esgotado",
    },
    tickets: {
      buy: "Comprar ingressos",
      atDoor: "Ingressos na porta",
      available: "Ingressos disponíveis",
    },
    metadata: {
      description: "Agenda de música ao vivo.",
    },
    footer: {
      updatedAt: (value: string): string => `Atualizado em ${value}`,
    },
  },
} as const satisfies Record<string, SiteMessages>;

export type Locale = keyof typeof localeMessages;

export function messagesFor(locale: Locale): SiteMessages {
  return localeMessages[locale];
}
