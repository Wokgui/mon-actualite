/**
 * Frontière entre l'interface et les futures sources réelles.
 * Le prototype analyse un OPML localement, sans envoyer le fichier.
 * Un futur backend pourra implémenter les deux adaptateurs décrits plus bas
 * sans modifier les écrans de l'application.
 */

export async function importOpmlPreview(file) {
  const xml = await file.text();
  const documentXml = new DOMParser().parseFromString(xml, "application/xml");
  if (documentXml.querySelector("parsererror")) throw new Error("Invalid OPML");

  const feeds = [...documentXml.querySelectorAll("outline[xmlUrl]")].map(node => ({
    title: node.getAttribute("title") || node.getAttribute("text") || "Source sans nom",
    xmlUrl: node.getAttribute("xmlUrl"),
    htmlUrl: node.getAttribute("htmlUrl") || "",
    category: node.parentElement?.getAttribute("text") || "Non classée"
  }));

  return { feeds, importedAt: new Date().toISOString() };
}

export const futureSourceGateway = {
  /** Remplacera les données factices par les articles des flux prioritaires. */
  async fetchPriorityFeeds() {
    return [];
  },

  /** Connexion Feedly éventuelle après autorisation OAuth côté serveur. */
  async syncFeedly() {
    throw new Error("Connecteur Feedly non configuré dans le prototype");
  }
};

export const futureWebSearchGateway = {
  /**
   * Appelé uniquement après comparaison avec les flux : le sujet doit être
   * important et insuffisamment couvert. Le serveur gardera les clés privées.
   */
  async searchMissingTopic() {
    return [];
  }
};
