(() => {
  const searchInput = document.querySelector("[data-search-input]");
  const searchRows = [...document.querySelectorAll("[data-event]")];
  const emptyState = document.querySelector("[data-no-results]");
  const resetButtons = [...document.querySelectorAll("[data-reset-search]")];

  if (!searchInput) return;

  const normalizeSearchText = (value) =>
    value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR");

  const applySearch = () => {
    const normalizedQuery = normalizeSearchText(
      searchInput.value.slice(0, 200),
    );
    let visibleCount = 0;

    for (const row of searchRows) {
      const isVisible = row.dataset.search?.includes(normalizedQuery) ?? true;
      row.hidden = !isVisible;
      if (isVisible) visibleCount++;
    }

    if (emptyState) emptyState.hidden = visibleCount !== 0;

    const currentUrl = new URL(location.href);
    if (normalizedQuery) {
      currentUrl.searchParams.set("q", searchInput.value);
    } else {
      currentUrl.searchParams.delete("q");
    }
    history.replaceState(null, "", currentUrl);
  };

  searchInput.value = new URL(location.href).searchParams.get("q") ?? "";
  searchInput.addEventListener("input", applySearch);

  for (const resetButton of resetButtons) {
    resetButton.addEventListener("click", () => {
      searchInput.value = "";
      applySearch();
      searchInput.focus();
    });
  }

  applySearch();
})();
