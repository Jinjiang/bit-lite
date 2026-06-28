describe("cypress arithmetic", () => {
  it("adds numbers", () => {
    cy.wrap(1 + 1).should("equal", 2);
  });
});
